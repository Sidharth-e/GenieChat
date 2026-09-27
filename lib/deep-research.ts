export const DEEP_RESEARCH_DEPTH_OPTIONS = [
  "low",
  "medium",
  "high",
  "very_high",
] as const;

export type DeepResearchDepth = (typeof DEEP_RESEARCH_DEPTH_OPTIONS)[number];

export interface DeepResearchDepthConfig {
  minQueries: number;
  maxQueries: number;
  maxIterations: number;
  maxTotalSearches: number;
  initialContextSearches: number;
}

const DEPTH_CONFIG: Record<DeepResearchDepth, DeepResearchDepthConfig> = {
  low: {
    minQueries: 8,
    maxQueries: 12,
    maxIterations: 6,
    maxTotalSearches: 30,
    initialContextSearches: 1,
  },
  medium: {
    minQueries: 15,
    maxQueries: 20,
    maxIterations: 15,
    maxTotalSearches: 100,
    initialContextSearches: 3,
  },
  high: {
    minQueries: 20,
    maxQueries: 30,
    maxIterations: 18,
    maxTotalSearches: 140,
    initialContextSearches: 3,
  },
  very_high: {
    minQueries: 30,
    maxQueries: 40,
    maxIterations: 22,
    maxTotalSearches: 200,
    initialContextSearches: 4,
  },
};

export function getDeepResearchDepthConfig(
  depth: DeepResearchDepth,
): DeepResearchDepthConfig {
  return DEPTH_CONFIG[depth];
}

export function parseDeepResearchDepth(
  value: unknown,
  fallback: DeepResearchDepth = "medium",
): DeepResearchDepth {
  if (typeof value !== "string") return fallback;
  if (DEEP_RESEARCH_DEPTH_OPTIONS.includes(value as DeepResearchDepth)) {
    return value as DeepResearchDepth;
  }
  return fallback;
}

