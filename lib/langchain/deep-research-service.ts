import "server-only";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getModel } from "./model-factory";
import { DEFAULT_MODEL_ID } from "./model-config";
import { webSearch } from "../tool/default-tools";
import {
  DeepResearchDepth,
  getDeepResearchDepthConfig,
} from "@/lib/deep-research";
import { Predict } from "@/lib/dspy";

// --- DSPy Modules for Deep Research ---

const titleGenerator = new Predict({
  inputs: [{ name: "query", type: "string" }],
  outputSchema: z.object({
    shortTitle: z.string().describe("Concise 3-7 word professional title"),
    fullTitle: z.string().describe("Comprehensive 8-20 word academic-style title"),
  }),
  instruction: "Convert a user query into professional research report titles (one short, one full).",
});

const researchPlanner = new Predict({
  inputs: [
    { name: "query", type: "string" },
    { name: "outline", type: "string" },
    { name: "minQueries", type: "number" },
    { name: "maxQueries", type: "number" },
  ],
  outputSchema: z.object({
    queries: z.array(z.string()).describe("List of diverse, specific search queries"),
    strategy_notes: z.string().describe("Brief explanation of the research coverage approach"),
  }),
  instruction: "Generate a targeted set of search queries based on a research outline.",
});

// --- Enhanced State Definition for Deep Research ---
const DeepResearchState = Annotation.Root({
  original_query: Annotation<string>(),
  search_queries: Annotation<string[]>(),
  gathered_info: Annotation<string[]>(),
  iteration: Annotation<number>(),
  final_answer: Annotation<string>(),
  total_searches_executed: Annotation<number>(),
  coverage_score: Annotation<number>(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  research_quality_metrics: Annotation<Record<string, any>>(),
  research_outline: Annotation<string>(),
  knowledge_graph: Annotation<Record<string, string[]>>(), // Track relationships
  contradictions: Annotation<string[]>(), // Track conflicting info
  confidence_scores: Annotation<Record<string, number>>(), // Track confidence per topic
  review_feedback: Annotation<string>(), // Feedback from reviewer
  draft_report: Annotation<string>(), // Intermediate draft
});

export class DeepResearchService {
  /**
   * Generates a professional, comprehensive title for the research report
   */
  async generateTitle(
    query: string,
    modelId: string = DEFAULT_MODEL_ID,
  ): Promise<{ shortTitle: string; fullTitle: string }> {
    const currentYear = new Date().getUTCFullYear();

    try {
      const result = await titleGenerator.forward(
        { query },
        { 
          modelId,
          systemInstruction: `You are a professional research report title generator. Short titles should be 3-7 words. Full titles should be 8-20 words and academic-style for ${currentYear}.`
        }
      );
      
      logger.info(`[Title Generation] Short: ${result.data.shortTitle}`);
      logger.info(`[Title Generation] Full: ${result.data.fullTitle}`);
      
      return result.data;
    } catch (e) {
      logger.error("[Title Generation] Error:", e);
    }

    // Fallback: clean up query to create title
    const cleanQuery = query
      .replace(/^(what is|how to|explain|tell me about|describe)\s+/i, "")
      .trim();
    const capitalizedQuery =
      cleanQuery.charAt(0).toUpperCase() + cleanQuery.slice(1);
    return {
      shortTitle:
        capitalizedQuery.length > 50
          ? capitalizedQuery.slice(0, 50) + "..."
          : capitalizedQuery,
      fullTitle: `Comprehensive Research Report: ${capitalizedQuery}`,
    };
  }

  /**
   * Phase 1: Generates a comprehensive multi-stage research plan
   */
  async planResearch(
    query: string,
    modelId: string = DEFAULT_MODEL_ID,
    depth: DeepResearchDepth = "medium",
  ): Promise<{ queries: string[]; outline: string }> {
    const model = getModel(modelId);
    const currentYear = new Date().getUTCFullYear();
    const previousYear = currentYear - 1;
    const depthConfig = getDeepResearchDepthConfig(depth);
    const { minQueries, maxQueries, initialContextSearches } = depthConfig;
    const recentYearPattern = new RegExp(
      `${previousYear}|${currentYear}|recent|latest|current|new`,
      "i",
    );

    // Step 0: Perform strategic preliminary searches
    logger.info(`[Planning] Gathering initial context...`);
    let searchContext = "";

    try {
      // Determine if we need multiple searches based on query complexity
      const isComplexQuery = query.split(" ").length > 5;

      const candidateInitialSearchQueries = isComplexQuery
        ? [query, `${query} latest ${currentYear}`, `${query} overview guide`]
        : [query];
      const initialSearchQueries = candidateInitialSearchQueries.slice(
        0,
        initialContextSearches,
      );

      logger.info(
        `[Planning] Executing ${initialSearchQueries.length} initial search(es)...`,
      );

      // Execute searches in parallel with timeout
      const searchPromises = initialSearchQueries.map(async (q) => {
        try {
          const result = await Promise.race([
            webSearch.invoke({ query: q }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Search timeout")), 20000),
            ),
          ]);
          return JSON.parse(result as string);
        } catch (e) {
          logger.warn(`[Planning] Search failed for "${q}": ${e}`);
          return null;
        }
      });

      const results = await Promise.all(searchPromises);
      const validResults = results.filter((r) => r !== null && r.answer);

      if (validResults.length > 0) {
        // Extract key information from searches
        const summaries = validResults.map((r) => r.answer);
        const allCitations = validResults.flatMap((r) => r.citations || []);
        const uniqueCitations = [...new Set(allCitations)].slice(0, 10);

        // Analyze for recency signals
        const hasRecentInfo = summaries.some((s) => recentYearPattern.test(s));

        searchContext = `
PRELIMINARY SEARCH CONTEXT (${validResults.length} search${validResults.length > 1 ? "es" : ""}):

${summaries
  .map(
    (summary, i) => `
Search ${i + 1} Findings:
${summary.substring(0, 500)}${summary.length > 500 ? "..." : ""}
`,
  )
  .join("\n")}

Key Sources Found:
${uniqueCitations
  .slice(0, 5)
  .map((url, i) => `${i + 1}. ${url}`)
  .join("\n")}

${
  hasRecentInfo
    ? `Recent information detected (${previousYear}-${currentYear}).`
    : "May need to search for recent developments."
}

CRITICAL INSTRUCTIONS:
- Use this information to ensure your outline covers the current state of the art.
- Identify any specific entities, products, versions, or key players mentioned.
- Note any time-sensitive aspects that require up-to-date research.
- Ensure research queries target both foundational and latest information.
`;

        logger.info(
          `[Planning] Gathered context from ${validResults.length} search(es)`,
        );
        logger.info(
          `[Planning] Found ${uniqueCitations.length} unique sources`,
        );
        logger.info(`[Planning] Recent info detected: ${hasRecentInfo}`);
      } else {
        logger.warn(
          `[Planning] No valid search results, proceeding with query-only planning`,
        );
        searchContext = `
NOTE: Initial web search did not return results. Ensure your outline includes:
- Plans to search for the latest information (${previousYear}-${currentYear})
- Both foundational concepts and current developments
- Verification queries to check for recent changes
`;
      }
    } catch (e) {
      logger.error(`[Planning] Initial search phase failed: ${e}`);
      searchContext = `
NOTE: Initial context gathering encountered an error. Proceed with comprehensive planning that includes:
- Explicit searches for current/recent information
- Verification of time-sensitive aspects
`;
    }

    // First, create a research outline
    const outlinePrompt = `You are a Research Planning Expert. Analyze this query and create a comprehensive research outline.

USER QUERY: "${query}"
${searchContext}

Create a detailed research outline covering:
1. Core concepts and definitions
2. Historical context and evolution
3. Current state of the art (as of ${currentYear})
4. Technical specifications and details
5. Comparative analysis (alternatives, competitors)
6. Use cases and applications
7. Limitations and challenges
8. Future trends and predictions
9. Expert opinions and consensus
10. Data, statistics, and metrics

${
  searchContext.includes("Recent information detected")
    ? "IMPORTANT: Initial search found recent information. Ensure outline covers latest developments."
    : `IMPORTANT: Search for the most current information (${previousYear}-${currentYear}) in addition to foundational knowledge.`
}

Format as a structured outline with main topics and subtopics.`;

    const outlineResponse = await model.invoke([
      new HumanMessage(outlinePrompt),
    ]);
    const outline =
      typeof outlineResponse.content === "string"
        ? outlineResponse.content
        : JSON.stringify(outlineResponse.content);

    // Then generate initial search queries based on outline using DSPy-inspired Predict module
    let queries: string[] = [];

    try {
      const result = await researchPlanner.forward(
        { query, outline, minQueries, maxQueries },
        { 
          modelId,
          systemInstruction: `You are a Search Strategy Expert. Generate ${minQueries}-${maxQueries} diverse, specific search queries covering foundation, technical, comparative, practical, temporal, critical, quantitative, and expert dimensions.`
        }
      );
      
      queries = result.data.queries || [];
      if (result.data.strategy_notes) {
        logger.info(`[Planning] Strategy: ${result.data.strategy_notes}`);
      }
    } catch (e) {
      logger.error("Failed to generate research plan queries", e);
    }

    // Ensure we have enough queries for the selected depth
    if (queries.length < minQueries) {
      const fallbackQueries = [
        query,
        `${query} comprehensive guide`,
        `${query} technical documentation`,
        `${query} detailed explanation`,
        `${query} vs alternatives comparison`,
        `${query} best practices`,
        `${query} latest developments ${previousYear} ${currentYear}`,
        `${query} statistics data`,
        `${query} expert analysis`,
        `${query} case studies examples`,
        `${query} challenges limitations`,
        `${query} implementation tutorial`,
        `${query} research papers`,
        `${query} market trends`,
        `${query} future outlook`,
        `${query} architecture explained`,
        `${query} advanced guide`,
        `${query} common mistakes`,
        `${query} governance and regulation`,
        `${query} benchmark comparison`,
        `${query} security risks`,
        `${query} enterprise adoption`,
        `${query} migration strategy`,
        `${query} real-world failures`,
        `${query} ecosystem landscape`,
        `${query} expert interviews`,
        `${query} open source tools`,
        `${query} implementation checklist`,
        `${query} compliance requirements`,
        `${query} ROI analysis`,
        `${query} performance metrics ${currentYear}`,
        `${query} timeline milestones`,
      ];
      queries = [...queries, ...fallbackQueries];
    }
    queries = [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(
      0,
      maxQueries,
    );

    logger.info(
      `[Planning] Generated ${queries.length} initial search queries (depth=${depth})`,
    );
    return { queries, outline };
  }

  /**
   * Phase 2: Executes ultra-deep research with multiple iteration cycles
   */
  async *executeResearch(
    originalQuery: string,
    plan: string[],
    outline: string = "",
    modelId: string = DEFAULT_MODEL_ID,
    depth: DeepResearchDepth = "medium",
  ) {
    const model = getModel(modelId);
    const currentYear = new Date().getUTCFullYear();
    const previousYear = currentYear - 1;
    const depthConfig = getDeepResearchDepthConfig(depth);
    const maxIterations = depthConfig.maxIterations;
    const maxTotalSearches = depthConfig.maxTotalSearches;

    // --- Node: Parallel Batch Researcher ---
    const researcherNode = async (state: typeof DeepResearchState.State) => {
      type SearchSuccessResult = {
        query: string;
        answer: string;
        citations: string[];
        timestamp: string;
        success: true;
        word_count: number;
      };
      type SearchFailureResult = {
        query: string;
        error: string;
        success: false;
      };
      type SearchResult = SearchSuccessResult | SearchFailureResult;

      const queries: string[] = state.search_queries || [];
      if (queries.length === 0) return {};

      const currentTotal = state.total_searches_executed || 0;
      if (currentTotal >= maxTotalSearches) {
        logger.info(
          `[Researcher] Reached max search limit (${maxTotalSearches})`,
        );
        return { search_queries: [] };
      }

      logger.info(
        `[Researcher] Executing batch of ${queries.length} searches in parallel...`,
      );

      // Execute all searches in parallel
      const searchPromises: Promise<SearchResult>[] = queries.map(
        async (q: string, index: number): Promise<SearchResult> => {
          try {
            // Add small delay to avoid rate limiting
            await new Promise((resolve) => setTimeout(resolve, index * 100));

            const output = await webSearch.invoke({ query: q });
            const resultJson = JSON.parse(output as string) as {
              answer?: string;
              citations?: string[];
              error?: string;
            };

            if (resultJson.answer) {
              return {
                query: q,
                answer: resultJson.answer,
                citations: resultJson.citations || [],
                timestamp: new Date().toISOString(),
                success: true,
                word_count: resultJson.answer.split(/\s+/).length,
              };
            }
            return {
              query: q,
              error: resultJson.error || "No answer",
              success: false,
            };
          } catch (e) {
            return {
              query: q,
              error: `Search failed: ${e}`,
              success: false,
            };
          }
        },
      );

      const results: SearchResult[] = await Promise.all(searchPromises);

      // Format results with rich metadata
      const formattedResults = results.map((r: SearchResult, idx: number) =>
        r.success
          ? `--- SEARCH RESULT #${currentTotal + idx + 1} ---
Query: ${r.query}
Finding: ${r.answer}
Citations: ${r.citations.join(", ")}
Word Count: ${r.word_count}
Timestamp: ${r.timestamp}
---`
          : `--- SEARCH RESULT #${currentTotal + idx + 1} (FAILED) ---
Query: ${r.query}
Error: ${r.error}
---`,
      );

      const successfulSearches = results.filter(
        (r: SearchResult) => r.success,
      ).length;
      const totalWords = results
        .filter((r: SearchResult): r is SearchSuccessResult => r.success)
        .reduce((sum: number, r: SearchSuccessResult) => sum + r.word_count, 0);

      logger.info(
        `[Researcher] Completed: ${successfulSearches}/${queries.length} successful, ${totalWords} words gathered`,
      );

      return {
        gathered_info: [...(state.gathered_info || []), ...formattedResults],
        search_queries: [],
        total_searches_executed: currentTotal + queries.length,
      };
    };

    // --- Helper: Generate dimension-specific queries ---
    const generateDimensionQueries = (
      dimension: string,
      query: string,
      iteration: number,
    ): string[] => {
      const queryPatterns: Record<string, string[]> = {
        foundational: [
          `what is ${query} comprehensive definition`,
          `${query} core concepts fundamentals explained`,
          `${query} basic principles for beginners`,
          `${query} terminology glossary key terms`,
        ],
        technical: [
          `${query} technical architecture specifications`,
          `${query} implementation details internals`,
          `${query} system design technical deep dive`,
          `${query} API documentation developer guide`,
          `${query} performance optimization technical`,
        ],
        comparative: [
          `${query} vs alternatives comparison ${currentYear}`,
          `${query} competitors analysis pros cons`,
          `${query} comparison chart features`,
          `best ${query} alternatives ranked`,
          `${query} trade-offs when to use`,
        ],
        practical: [
          `${query} real world use cases examples`,
          `${query} case study implementation`,
          `${query} best practices production`,
          `${query} tutorial step by step guide`,
          `how companies use ${query} success stories`,
        ],
        temporal: [
          `${query} latest news updates ${previousYear} ${currentYear}`,
          `${query} history evolution timeline`,
          `${query} future roadmap predictions`,
          `${query} recent developments announcements`,
          `${query} trends forecast next year`,
        ],
        critical: [
          `${query} limitations drawbacks problems`,
          `${query} criticism controversy issues`,
          `${query} failures risks challenges`,
          `${query} security concerns vulnerabilities`,
          `why ${query} fails common mistakes`,
        ],
        quantitative: [
          `${query} statistics market data ${currentYear}`,
          `${query} benchmarks performance metrics`,
          `${query} adoption rates user statistics`,
          `${query} market size growth numbers`,
          `${query} pricing cost analysis ROI`,
        ],
        expert: [
          `${query} academic research papers`,
          `${query} expert analysis opinion`,
          `${query} industry analyst report`,
          `${query} research study findings`,
          `${query} official documentation whitepaper`,
        ],
      };

      const patterns = queryPatterns[dimension] || [];
      const startIdx = Math.min(
        iteration % patterns.length,
        patterns.length - 2,
      );
      return patterns.slice(startIdx, startIdx + 2);
    };

    // --- Node: Deep Analysis & Gap Identification ---
    const analyserNode = async (state: typeof DeepResearchState.State) => {
      const currentIteration = state.iteration || 0;
      const totalSearches = state.total_searches_executed || 0;
      const previousDimensionScores =
        state.research_quality_metrics?.dimension_scores || {};

      logger.info(
        `[Analyser] === ITERATION ${currentIteration}/${maxIterations} === (${totalSearches} total searches)`,
      );

      // Stop conditions
      if (currentIteration >= maxIterations) {
        logger.info(
          `[Analyser] Max iterations reached. Proceeding to report generation.`,
        );
        return {
          iteration: currentIteration + 1,
          coverage_score: 95,
        };
      }

      if (totalSearches >= maxTotalSearches) {
        logger.info(
          `[Analyser] Max searches reached (${maxTotalSearches}). Finalizing.`,
        );
        return {
          iteration: maxIterations + 1,
          coverage_score: 90,
        };
      }

      // Determine research phase for progressive deepening
      const researchPhase =
        currentIteration <= 4
          ? "FOUNDATIONAL"
          : currentIteration <= 9
            ? "DEEP_TECHNICAL"
            : "EXPERT_CRITICAL";

      const phaseGuidance: Record<string, string> = {
        FOUNDATIONAL: `PHASE 1 (Foundational): Focus on core definitions, basics, overview content. Ensure foundational and practical dimensions reach 80%+.`,
        DEEP_TECHNICAL: `PHASE 2 (Deep Technical): Focus on technical specifications, comparisons, implementation details. Target technical and comparative dimensions to reach 80%+.`,
        EXPERT_CRITICAL: `PHASE 3 (Expert/Critical): Focus on expert opinions, academic sources, limitations, and quantitative data. Push critical, expert, and quantitative to 80%+.`,
      };

      logger.info(`[Analyser] Research Phase: ${researchPhase}`);

      const context = state.gathered_info?.join("\n\n") || "";
      const alreadySearched: string[] =
        state.gathered_info
          ?.map((info: string) => info.match(/Query: (.+?)\n/)?.[1])
          .filter(
            (entry): entry is string =>
              typeof entry === "string" && entry.length > 0,
          ) || [];

      // Track source diversity
      const sourceDomains = new Set<string>();
      state.gathered_info?.forEach((info: string) => {
        const citationMatch = info.match(/Citations: (.+?)(?:\n|$)/);
        if (citationMatch) {
          citationMatch[1].split(", ").forEach((url: string) => {
            try {
              if (url.startsWith("http")) {
                sourceDomains.add(new URL(url).hostname);
              }
            } catch {}
          });
        }
      });
      const sourceDiversityCount = sourceDomains.size;

      // Progressive coverage targets based on iteration
      const baseCoverage = 60;
      const targetCoverage = Math.min(95, baseCoverage + currentIteration * 3);
      const minDimensionScore =
        currentIteration <= 4 ? 50 : currentIteration <= 9 ? 65 : 75;

      const analysisPrompt = `You are an Expert Research Analyst conducting iteration ${currentIteration} of a comprehensive research assessment.

USER QUERY: "${state.original_query}"

═══════════════════════════════════════════════════════════════════
RESEARCH PHASE: ${researchPhase}
${phaseGuidance[researchPhase]}
═══════════════════════════════════════════════════════════════════

RESEARCH OUTLINE:
${state.research_outline || "Not available"}

PROGRESS METRICS:
- Iteration: ${currentIteration}/${maxIterations}
- Total Searches: ${totalSearches}/${maxTotalSearches}
- Sources Gathered: ${state.gathered_info?.length || 0}
- Unique Source Domains: ${sourceDiversityCount}
- Target Coverage This Iteration: ${targetCoverage}%
- Minimum Dimension Score Required: ${minDimensionScore}%

PREVIOUS DIMENSION SCORES (must improve these):
${
  Object.keys(previousDimensionScores).length > 0
    ? Object.entries(previousDimensionScores)
        .map(([k, v]) => `• ${k}: ${v}%`)
        .join("\n")
    : "• No previous scores (first iteration)"
}

COMPLETED SEARCHES (${alreadySearched.length}):
${alreadySearched
  .slice(0, 40)
  .map((q: string, i: number) => `${i + 1}. ${q}`)
  .join("\n")}
${alreadySearched.length > 40 ? `... and ${alreadySearched.length - 40} more` : ""}

GATHERED RESEARCH DATA:
${context.length > 20000 ? context.substring(0, 20000) + "\n\n... [TRUNCATED - " + (context.length - 20000) + " more characters available]" : context}

═══════════════════════════════════════════════════════════════════

COMPREHENSIVE ANALYSIS TASK:

Meticulously assess research completeness across ALL 8 dimensions. Be PRECISE and HONEST in scoring based on ACTUAL gathered data:

1. **Foundational Understanding** (0-100%): Core concepts, definitions, fundamentals
2. **Technical Depth** (0-100%): Specifications, architecture, implementation details
3. **Comparative Context** (0-100%): Alternatives, competitors, trade-offs
4. **Practical Application** (0-100%): Use cases, examples, best practices
5. **Temporal Coverage** (0-100%): History, current state (${previousYear}-${currentYear}), future trends
6. **Critical Perspective** (0-100%): Limitations, challenges, controversies, risks
7. **Quantitative Data** (0-100%): Statistics, metrics, benchmarks, market numbers
8. **Expert Consensus** (0-100%): Academic research, authority opinions, official sources

SCORING RULES:
- Score based on ACTUAL data gathered, not assumptions
- 0-30%: Almost nothing found
- 31-50%: Basic/superficial coverage
- 51-70%: Moderate coverage with gaps
- 71-85%: Good coverage with minor gaps
- 86-95%: Comprehensive coverage
- 96-100%: Exhaustive/definitive coverage

CRITICAL REQUIREMENTS:
1. IDENTIFY dimensions scoring BELOW ${minDimensionScore}% - these MUST have targeted queries
2. Generate 2-3 SPECIFIC queries for EACH low-scoring dimension
3. Use dimension-specific query patterns:
   • Quantitative: Include "statistics", "data", "numbers", "metrics", "benchmarks"
   • Expert: Include "research paper", "academic", "expert analysis", "study"
   • Critical: Include "limitations", "problems", "failures", "risks", "criticism"
   • Comparative: Include "vs", "comparison", "alternatives", "better than"
   • Technical: Include "architecture", "implementation", "specifications", "how works"

4. Queries must be SUBSTANTIALLY DIFFERENT from completed searches
5. Continue researching until ALL dimensions reach ${minDimensionScore}%+ OR max searches reached

DECISION RULES:
- If ANY dimension < ${minDimensionScore}%: Status = "RESEARCH"
- If overall_coverage < ${targetCoverage}%: Status = "RESEARCH"
- Only status = "READY" if: overall >= ${targetCoverage}% AND all dimensions >= ${minDimensionScore}%

STRICT JSON FORMAT (no markdown, no preamble):
{
  "status": "RESEARCH" or "READY",
  "overall_coverage": number,
  "dimension_scores": {
    "foundational": number,
    "technical": number,
    "comparative": number,
    "practical": number,
    "temporal": number,
    "critical": number,
    "quantitative": number,
    "expert": number
  },
  "low_dimensions": ["dimension1", "dimension2"],
  "gaps_identified": [
    "Missing: specific X for dimension Y",
    "Insufficient: Z data"
  ],
  "queries": ["targeted query 1", "targeted query 2", ...],
  "reasoning": "Explanation of scores and what's needed"
}`;

      try {
        const response = await model.invoke([new HumanMessage(analysisPrompt)]);
        const content =
          typeof response.content === "string"
            ? response.content
            : JSON.stringify(response.content);

        const cleanContent = content
          .replace(/```json\n?/g, "")
          .replace(/```\n?/g, "");
        const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const dimensionScores = parsed.dimension_scores || {};

          logger.info(
            `[Analyser] Overall Coverage: ${parsed.overall_coverage || 0}%`,
          );
          logger.info(`[Analyser] Dimension Scores:`, dimensionScores);
          logger.info(`[Analyser] Status: ${parsed.status}`);
          logger.info(
            `[Analyser] Source Diversity: ${sourceDiversityCount} unique domains`,
          );

          if (parsed.gaps_identified?.length > 0) {
            logger.info(`[Analyser] Gaps Found:`);
            parsed.gaps_identified.forEach((gap: string, i: number) => {
              logger.info(`  ${i + 1}. ${gap}`);
            });
          }

          // Find dimensions below threshold
          const lowDimensions = Object.entries(dimensionScores)
            .filter(([, score]) => (score as number) < minDimensionScore)
            .sort((a, b) => (a[1] as number) - (b[1] as number))
            .map(([dim]) => dim);

          if (lowDimensions.length > 0) {
            logger.info(
              `[Analyser] Low Dimensions (< ${minDimensionScore}%): ${lowDimensions.join(", ")}`,
            );
          }

          // Advanced duplicate detection with lower threshold for diverse queries
          const filterDuplicates = (queries: string[]): string[] => {
            return queries.filter((q: string) => {
              const qLower = q.toLowerCase();
              const qWords = new Set(
                qLower.split(/\s+/).filter((w) => w.length > 3),
              );

              return !alreadySearched.some((prev: string) => {
                if (!prev) return false;
                const prevLower = prev.toLowerCase();
                const prevWords = new Set(
                  prevLower.split(/\s+/).filter((w: string) => w.length > 3),
                );

                const intersection = new Set(
                  [...qWords].filter((x) => prevWords.has(x)),
                );
                const union = new Set([...qWords, ...prevWords]);
                const similarity = intersection.size / union.size;

                return similarity > 0.5; // Slightly lower threshold
              });
            });
          };

          if (
            parsed.status === "RESEARCH" &&
            (parsed.queries?.length > 0 || lowDimensions.length > 0)
          ) {
            let newQueries = filterDuplicates(parsed.queries || []);

            // If LLM queries were mostly filtered, generate dimension-specific queries
            if (newQueries.length < 4 && lowDimensions.length > 0) {
              logger.info(
                `[Analyser] Generating dimension-targeted queries for: ${lowDimensions.slice(0, 3).join(", ")}`,
              );
              const dimensionQueries = lowDimensions
                .slice(0, 3)
                .flatMap((dim) =>
                  generateDimensionQueries(
                    dim,
                    state.original_query,
                    currentIteration,
                  ),
                );
              const filteredDimensionQueries =
                filterDuplicates(dimensionQueries);
              newQueries = [...newQueries, ...filteredDimensionQueries];
            }

            // Additional fallback: perspective-shifted queries
            if (newQueries.length < 3 && currentIteration < maxIterations - 2) {
              const perspectives = [
                `${state.original_query} from developer perspective`,
                `${state.original_query} from business perspective`,
                `${state.original_query} reddit discussion opinions`,
                `${state.original_query} stackoverflow common questions`,
                `${state.original_query} hackernews analysis`,
              ];
              const filteredPerspectives = filterDuplicates(perspectives);
              newQueries = [...newQueries, ...filteredPerspectives.slice(0, 2)];
            }

            if (newQueries.length > 0) {
              logger.info(
                `[Analyser] Generated ${newQueries.length} unique queries for next batch`,
              );
              return {
                search_queries: newQueries.slice(0, 10), // Increased to 10 per iteration
                iteration: currentIteration + 1,
                coverage_score: parsed.overall_coverage || 70,
                research_quality_metrics: {
                  dimension_scores: dimensionScores,
                  gaps: parsed.gaps_identified,
                  low_dimensions: lowDimensions,
                  source_diversity: sourceDiversityCount,
                  reasoning: parsed.reasoning,
                },
              };
            } else {
              logger.info(
                `[Analyser] All queries filtered. Checking if coverage is sufficient...`,
              );
              const allDimensionsOk = lowDimensions.length === 0;
              const coverageOk =
                (parsed.overall_coverage || 0) >= targetCoverage - 10;

              if (allDimensionsOk && coverageOk) {
                logger.info(
                  `[Analyser] Coverage acceptable. Proceeding to synthesis.`,
                );
                return {
                  iteration: maxIterations + 1,
                  coverage_score: parsed.overall_coverage || 85,
                  research_quality_metrics: {
                    dimension_scores: dimensionScores,
                    reasoning: parsed.reasoning,
                  },
                };
              }
            }
          } else if (parsed.status === "READY") {
            logger.info(
              `[Analyser] Research deemed comprehensive. Proceeding to synthesis.`,
            );
            return {
              iteration: maxIterations + 1,
              coverage_score: parsed.overall_coverage || 90,
              research_quality_metrics: {
                dimension_scores: dimensionScores,
                reasoning: parsed.reasoning,
              },
            };
          }
        }
      } catch (e) {
        logger.error("[Analyser] Error:", e);
      }

      // Enhanced fallback: Generate phase-appropriate queries
      if (
        currentIteration <= maxIterations - 2 &&
        totalSearches < maxTotalSearches - 10
      ) {
        logger.info(
          `[Analyser] Fallback: Generating phase-appropriate queries for ${researchPhase}`,
        );

        const fallbackQueries: Record<string, string[]> = {
          FOUNDATIONAL: [
            `${state.original_query} complete beginner guide`,
            `${state.original_query} explained simply`,
            `${state.original_query} key concepts overview`,
          ],
          DEEP_TECHNICAL: [
            `${state.original_query} technical architecture`,
            `${state.original_query} vs top alternatives ${currentYear}`,
            `${state.original_query} implementation internals`,
          ],
          EXPERT_CRITICAL: [
            `${state.original_query} academic research papers`,
            `${state.original_query} known issues limitations`,
            `${state.original_query} industry statistics ${currentYear}`,
          ],
        };

        return {
          search_queries:
            fallbackQueries[researchPhase] || fallbackQueries.FOUNDATIONAL,
          iteration: currentIteration + 1,
          coverage_score: 60 + currentIteration * 2,
        };
      }

      logger.info(`[Analyser] Completing research phase.`);
      return {
        iteration: maxIterations + 1,
        coverage_score: 85,
      };
    };

    // --- Node: Comprehensive Report Writer ---
    const writerNode = async (state: typeof DeepResearchState.State) => {
      logger.info(`[Writer] === GENERATING COMPREHENSIVE RESEARCH REPORT ===`);

      const context = state.gathered_info?.join("\n\n") || "";
      const wordCount = context.split(/\s+/).length;
      const sourceCount = state.gathered_info?.length || 0;
      const searchCount = state.total_searches_executed || 0;

      // Extract and organize citations
      const citationUrls = [
        ...new Set(
          state.gathered_info?.flatMap((info: string) => {
            const match = info.match(/Citations: (.+?)(?:\n|$)/);
            if (!match) return [];
            return match[1]
              .split(", ")
              .filter((url: string) => url && url.startsWith("http"));
          }) || [],
        ),
      ];

      const citationMap =
        citationUrls.length > 0
          ? citationUrls.map((url, i) => `[${i + 1}] ${url}`).join("\n")
          : "Citations not available";

      const dimensionScores =
        state.research_quality_metrics?.dimension_scores || {};
      const gaps = state.research_quality_metrics?.gaps || [];

      const writerPrompt = `You are a world-class Research Analyst writing an EXHAUSTIVE, publication-quality research report.

===== RESEARCH QUERY =====
"${state.original_query}"

===== RESEARCH METRICS =====
• Total Searches Executed: ${searchCount}
• Information Sources: ${sourceCount}
• Research Iterations: ${state.iteration || 0}
• Overall Coverage: ${state.coverage_score || 0}%
• Data Volume: ~${wordCount.toLocaleString()} words
• Dimension Coverage: ${JSON.stringify(dimensionScores, null, 2)}

===== RESEARCH OUTLINE =====
${state.research_outline || "Comprehensive exploration of all aspects"}

===== GATHERED RESEARCH DATA =====
${context}

===== CITATION DATABASE =====
${citationMap}

${
  gaps.length > 0
    ? `===== KNOWN LIMITATIONS =====
${gaps.map((g: string, i: number) => `${i + 1}. ${g}`).join("\n")}`
    : ""
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COMPREHENSIVE REPORT REQUIREMENTS:

You are writing a DEFINITIVE, EXHAUSTIVE research report that will serve as the authoritative resource on this topic. This should be the most thorough analysis possible.

═══════════════════════════════════════════════════════════════════════════════

📋 STRUCTURE (use markdown formatting):

# Executive Summary
**Length**: 4-6 comprehensive paragraphs
- Direct answer to the core query (crystal clear, definitive)
- 5-7 key findings in bullet format
- Most critical insights and implications
- Bottom-line recommendations or conclusions

# Table of Contents
- Auto-generate based on your sections below

# 1. Introduction & Context
**Length**: 3-4 paragraphs
- Topic significance and relevance
- Historical background and evolution
- Scope of this research (what's covered, methodology)
- Key questions this report answers

# 2. Foundational Understanding
**Length**: 5-8 paragraphs with subsections
## 2.1 Core Concepts & Definitions
## 2.2 Fundamental Principles
## 2.3 Theoretical Framework
- Explain from first principles
- Define all technical terms
- Provide conceptual models or frameworks

# 3. Technical Deep Dive
**Length**: 8-12 paragraphs with multiple subsections
## 3.1 Architecture/Structure
## 3.2 Key Components/Mechanisms
## 3.3 Technical Specifications
## 3.4 Implementation Details
- Exhaustive technical analysis
- Include specifications, parameters, configurations
- Diagrams descriptions if applicable
- Code snippets, formulas, or technical processes

# 4. Comparative Analysis
**Length**: 6-8 paragraphs with comparison tables
## 4.1 Alternative Approaches
## 4.2 Competitive Landscape
## 4.3 Trade-offs & Decision Factors
- Side-by-side comparisons (use markdown tables)
- Pros and cons analysis
- When to use what
- Cost-benefit considerations

# 5. Practical Applications & Use Cases
**Length**: 6-8 paragraphs
## 5.1 Real-World Implementations
## 5.2 Industry Applications
## 5.3 Case Studies
## 5.4 Best Practices
- Specific examples with details
- Success stories and lessons learned
- Implementation guidelines
- Common pitfalls to avoid

# 6. Current State & Recent Developments
**Length**: 5-7 paragraphs
## 6.1 Market Landscape
## 6.2 Latest Innovations (${previousYear}-${currentYear})
## 6.3 Adoption Trends
## 6.4 Industry Leaders
- Recent news and announcements
- Timeline of key developments
- Current statistics and metrics
- Market size, growth rates, adoption figures

# 7. Critical Evaluation
**Length**: 5-7 paragraphs
## 7.1 Limitations & Challenges
## 7.2 Criticisms & Controversies
## 7.3 Risk Factors
## 7.4 Failure Cases
- Honest assessment of weaknesses
- Known problems and their severity
- What doesn't work well
- Realistic constraints

# 8. Data, Statistics & Quantitative Analysis
**Length**: 4-6 paragraphs with data tables
- Comprehensive statistics compilation
- Benchmarks and performance metrics
- Market data, usage statistics
- Trend analysis with numbers
- Create markdown tables for data presentation

# 9. Expert Perspectives & Consensus
**Length**: 4-5 paragraphs
- Academic research findings
- Industry expert opinions
- Authoritative source perspectives
- Areas of agreement and debate
- Conflicting viewpoints reconciled

# 10. Future Outlook & Predictions
**Length**: 4-5 paragraphs
## 10.1 Emerging Trends
## 10.2 Future Roadmap
## 10.3 Potential Disruptions
- Forecasts and predictions
- Upcoming developments
- Long-term implications
- Scenarios and possibilities

# 11. Synthesis & Key Takeaways
**Length**: 4-5 paragraphs
- Integration of all findings
- 10-15 numbered key insights
- Actionable recommendations
- Decision framework for stakeholders

# 12. Research Limitations
**Length**: 2-3 paragraphs
- What this research couldn't fully address
- Information gaps and uncertainties
- Conflicting sources and how resolved
- Areas requiring further investigation

# 13. Conclusion
**Length**: 3-4 paragraphs
- Comprehensive final synthesis
- Definitive answer to original query
- Strategic implications
- Final recommendations
- Closing thoughts on significance

# References & Citations
- Complete numbered list of all [N] citations used
- Organized and formatted

═══════════════════════════════════════════════════════════════════════════════

📏 WRITING STANDARDS:

**1. LENGTH REQUIREMENTS**
   • Target: 5,000-8,000 words MINIMUM
   • Each major section: 400-800+ words
   • Every subsection: 200-400+ words
   • Be COMPREHENSIVE, not concise

**2. CITATION REQUIREMENTS** [CRITICAL]
   • EVERY factual claim MUST be cited using [1], [2], etc.
   • Multiple citations when appropriate [1][2][3]
   • Err on side of over-citing (better too many than too few)
   • Map to citation database provided above
   • Claims without citations = unacceptable

**3. DEPTH & DETAIL REQUIREMENTS**
   • Include ALL relevant specifics: numbers, dates, names, percentages
   • Technical terms with explanations
   • Specific examples, not generic statements
   • Quantify everything possible
   • No vague or hand-wavy statements

**4. STRUCTURAL REQUIREMENTS**
   • Use hierarchical markdown headers (# ## ###)
   • Bullet points for lists (minimum 3-4 points per list)
   • Numbered lists for sequences/rankings
   • Markdown tables for comparisons/data
   • **Bold** for key terms on first use
   • Clear paragraph breaks (don't create walls of text)

**5. CONTENT QUALITY STANDARDS**
   • Every paragraph = substantive information (no fluff)
   • Lead with most important information
   • Use topic sentences for each paragraph
   • Smooth transitions between sections
   • Build arguments logically and progressively
   • Address counter-arguments and alternatives

**6. OBJECTIVITY & BALANCE**
   • Present multiple perspectives on controversial topics
   • Clearly distinguish facts from opinions
   • Note when sources disagree (with citations)
   • Acknowledge uncertainties and limitations
   • Avoid bias or advocacy (unless query requests opinion)

**7. CLARITY & ACCESSIBILITY**
   • Define technical jargon on first use
   • Use analogies for complex concepts
   • Provide context for specialized information
   • Write for intelligent non-expert audience
   • Balance depth with comprehensibility

**8. COMPLETENESS STANDARDS**
   • Answer ALL aspects of original query
   • Address related questions user might have
   • Provide sufficient detail for decision-making
   • Include both theoretical and practical dimensions
   • Cover past, present, and future

═══════════════════════════════════════════════════════════════════════════════

🎯 TONE & STYLE:

• Professional, authoritative, analytical
• Confident but not arrogant
• Precise and specific
• Evidence-based and data-driven
• Academic rigor with business accessibility
• Engaging but not casual
• Think: Harvard Business Review meets Nature Journal

═══════════════════════════════════════════════════════════════════════════════

⚠️ CRITICAL REMINDERS:

1. This report should be SO comprehensive that readers won't need to search elsewhere
2. Treat this as your magnum opus - the definitive work on this topic
3. Every section should feel complete and satisfying
4. Use ALL the research data provided - don't leave valuable insights unused
5. The more detailed and thorough, the better
6. Quality over brevity - expand on everything important

═══════════════════════════════════════════════════════════════════════════════

BEGIN WRITING THE COMPREHENSIVE RESEARCH REPORT NOW:

`;

      const response = await model.invoke([
        new SystemMessage(
          `You are a world-class research analyst and technical writer known for producing the most comprehensive, well-researched, and authoritative reports in your field. Your reports are referenced as definitive sources. You never compromise on depth, accuracy, or thoroughness.`,
        ),
        new HumanMessage(writerPrompt),
      ]);

      const finalReport =
        typeof response.content === "string"
          ? response.content
          : JSON.stringify(response.content);

      const reportWordCount = finalReport.split(/\s+/).length;
      logger.info(
        `[Writer] Report generated: ${reportWordCount.toLocaleString()} words, ${finalReport.length.toLocaleString()} characters`,
      );

      return {
        final_answer: finalReport,
        draft_report: finalReport,
      };
    };

    // --- Node: Reviewer ---
    const reviewerNode = async (state: typeof DeepResearchState.State) => {
      logger.info(`[Reviewer] === REVIEWING DRAFT REPORT ===`);
      const draft = state.draft_report || state.final_answer || "";

      if (!draft) {
        logger.info("[Reviewer] No draft to review. Skipping.");
        return {};
      }

      const reviewPrompt = `You are a Senior Editor and Fact Checker. Review this research report draft.

USER QUERY: "${originalQuery}"

DRAFT REPORT:
${draft.substring(0, 50000)} ... [Truncated if too long]

CRITICAL REVIEW CRITERIA:
1. **Comprehensiveness**: Did it answer the query exhaustively? Are key aspects missing?
2. **Citations**: Are claims properly cited with [1], [2] etc? Are there enough citations?
3. **Structure**: Is the flow logical? Are headers used correctly?
4. **Tone**: Is it professional, objective, and authoritative?
5. **Length/Depth**: Is it too brief? Does it lack specific details (numbers, dates)?

OUTPUT FORMAT (JSON):
{
  "pass": boolean, // true if report is excellent, false if needs revision
  "feedback": "Specific instructions for the writer on what to fix. Be constructive but demanding.",
  "score": number // 0-100 quality score
}`;

      try {
        const response = await model.invoke([new HumanMessage(reviewPrompt)]);
        const content =
          typeof response.content === "string"
            ? response.content
            : JSON.stringify(response.content);

        const cleanContent = content
          .replace(/```json\n?/g, "")
          .replace(/```\n?/g, "");
        const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          logger.info(
            `[Reviewer] Score: ${parsed.score}/100 | Pass: ${parsed.pass}`,
          );
          if (!parsed.pass) {
            logger.info(`[Reviewer] Feedback: ${parsed.feedback}`);
          }
          return {
            review_feedback: parsed.feedback,
            coverage_score: parsed.score, // Reuse this field to track quality
          };
        }
      } catch (e) {
        logger.error("[Reviewer] Error:", e);
      }

      // Fallback if parsing fails - assume pass to avoid getting stuck
      return { review_feedback: "LGTM", coverage_score: 100 };
    };

    // --- Node: Reviser ---
    const reviserNode = async (state: typeof DeepResearchState.State) => {
      logger.info(`[Reviser] === REVISING REPORT BASED ON FEEDBACK ===`);
      const draft = state.draft_report || state.final_answer || "";
      const feedback = state.review_feedback || "";

      const reviserPrompt = `You are an Expert Editor. Improve this report based on the feedback.

FEEDBACK: "${feedback}"

ORIGINAL DRAFT:
${draft}

INSTRUCTIONS:
1. Address ALL points in the feedback.
2. Maintain the markdown formatting.
3. Keep the citations intact (or add more if requested).
4. Return the FULL polished report.
5. Make it PERFECTION.

Return ONLY the polished report content (markdown).`;

      const response = await model.invoke([new HumanMessage(reviserPrompt)]);
      const finalReport =
        typeof response.content === "string"
          ? response.content
          : JSON.stringify(response.content);

      const reportWordCount = finalReport.split(/\s+/).length;
      logger.info(
        `[Reviser] Revised report: ${reportWordCount.toLocaleString()} words`,
      );

      return {
        final_answer: finalReport,
        // Clear feedback to indicate done
        review_feedback: undefined,
      };
    };

    // --- Build Graph ---
    const workflow = new StateGraph(DeepResearchState)
      .addNode("researcher", researcherNode)
      .addNode("analyser", analyserNode)
      .addNode("writer", writerNode)
      .addNode("reviewer", reviewerNode)
      .addNode("reviser", reviserNode)
      .addEdge(START, "researcher")
      .addEdge("researcher", "analyser");

    workflow.addConditionalEdges("analyser", (state) => {
      if (
        state.search_queries &&
        state.search_queries.length > 0 &&
        state.iteration <= maxIterations &&
        state.total_searches_executed < maxTotalSearches
      ) {
        return "researcher";
      }
      return "writer";
    });

    workflow.addEdge("writer", "reviewer");

    workflow.addConditionalEdges("reviewer", (state) => {
      const quality = state.coverage_score || 0;
      // If quality is high enough or we don't have feedback (fallback), end
      // Note: coverage_score is overloaded here to mean quality score from reviewer
      if (
        quality >= 90 ||
        !state.review_feedback ||
        state.review_feedback === "LGTM"
      ) {
        return END;
      }
      return "reviser";
    });

    workflow.addEdge("reviser", END);

    const app = workflow.compile();

    const initialState = {
      original_query: originalQuery,
      search_queries: plan,
      research_outline: outline,
      iteration: 1,
      gathered_info: [],
      total_searches_executed: 0,
      coverage_score: 0,
      research_quality_metrics: {},
      knowledge_graph: {},
      contradictions: [],
      confidence_scores: {},
    };

    const run = await app.stream(initialState, { recursionLimit: 100 });

    logger.info("[Deep Research] ===========================================");
    logger.info("[Deep Research] Ultra-Deep Research Workflow Initiated");
    logger.info(
      `[Deep Research] Target depth=${depth} | max searches=${maxTotalSearches}, max iterations=${maxIterations}`,
    );
    logger.info("[Deep Research] ===========================================");

    // Track the latest draft report locally to avoid needing a checkpointer
    let latestDraftReport = "";

    for await (const event of run) {
      const nodeName = Object.keys(event)[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (event as Record<string, any>)[nodeName];

      if (nodeName === "researcher") {
        const totalFindings = data.gathered_info?.length || 0;
        const totalSearches = data.total_searches_executed || 0;
        yield {
          type: "status",
          content: `Search batch complete | Total: ${totalSearches} searches | Sources: ${totalFindings}`,
        };
      } else if (nodeName === "analyser") {
        if (data.search_queries && data.search_queries.length > 0) {
          const coverageScore = data.coverage_score || 0;
          const iteration = data.iteration || 0;
          const dimensionScores =
            data.research_quality_metrics?.dimension_scores;
          const gaps = data.research_quality_metrics?.gaps || [];

          let statusMsg = `Analysis [Iteration ${iteration}/${maxIterations}] | Coverage: ${coverageScore}%`;
          if (dimensionScores) {
            const scores = Object.values(dimensionScores) as number[];
            const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
            statusMsg += ` | Avg Dimension Score: ${Math.round(avgScore)}%`;
          }
          statusMsg += `\n   -> Found ${data.search_queries.length} knowledge gaps. Conducting deeper research...`;
          if (gaps.length > 0) {
            statusMsg += `\n   -> Key gaps: ${gaps.slice(0, 2).join("; ")}`;
          }

          yield {
            type: "status",
            content: statusMsg,
          };
        } else {
          const finalCoverage = data.coverage_score || 100;
          const totalSearches = data.total_searches_executed || 0;
          yield {
            type: "status",
            content: `Research phase complete | ${totalSearches} total searches | Coverage: ${finalCoverage}%\n   -> Synthesizing comprehensive ${(totalSearches * 100).toLocaleString()}-word report...`,
          };
        }
      } else if (nodeName === "writer") {
        // Capture the draft report for later use
        if (data.final_answer) {
          latestDraftReport = data.final_answer;
        }
        const wordCount = data.final_answer?.split(/\s+/).length || 0;
        yield {
          type: "status",
          content: `Draft generated | ${wordCount.toLocaleString()} words | Sending for review...`,
        };
      } else if (nodeName === "reviewer") {
        const score = data.coverage_score || 0;
        const passed = score >= 90;
        yield {
          type: "status",
          content: `Review complete | Quality score: ${score}/100 | ${passed ? "Passed" : "Needs revision"}`,
        };
        // If passed, yield the final report directly since reviser won't run
        if (passed && latestDraftReport) {
          yield {
            type: "final",
            content: latestDraftReport,
          };
        }
      } else if (nodeName === "reviser") {
        yield {
          type: "status",
          content: `Revision complete | Final polish applied`,
        };
        yield {
          type: "final",
          content: data.final_answer,
        };
      }
    }

    logger.info("[Deep Research] ===========================================");
    logger.info("[Deep Research] Workflow Completed Successfully");
    logger.info("[Deep Research] ===========================================");
  }
}

export const deepResearchService = new DeepResearchService();
