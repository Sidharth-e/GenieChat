
import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { deepResearchService } from "@/lib/langchain/deep-research-service";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { store } from "@/lib/store";
import { getDeepResearchStore } from "@/lib/mongodb/deep-research-store";
import { putObject } from "@/lib/storage";
import { keyForUser } from "@/lib/storage/ref";
import { STORAGE_BUCKETS } from "@/constants/storage";
import { generateId } from "@/lib/utils";
import { config, isDatabaseConfigured } from "@/lib/config";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { parseDeepResearchDepth } from "@/lib/deep-research";

function isModelAuthError(error: unknown): boolean {
    const e = error as { status?: number; lc_error_code?: string; message?: string };
    const message = e?.message?.toLowerCase() || "";
    return (
        e?.status === 401 ||
        e?.lc_error_code === "MODEL_AUTHENTICATION" ||
        message.includes("invalid subscription key") ||
        message.includes("wrong api endpoint") ||
        message.includes("model_authentication")
    );
}

export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        const userId = session.user.id;
        const userName = session.user.name || "";
        const userEmail = session.user.email || "";
        const rateLimit = await checkRateLimit(req, {
            namespace: "deep_research_execute",
            identifier: userId,
            ...config.rateLimit.researchExecute,
        });
        if (!rateLimit.allowed) {
            return new NextResponse(
                `Too many deep research execute requests. Retry after ${rateLimit.retryAfterSeconds}s`,
                {
                    status: 429,
                    headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
                },
            );
        }

        const { message, plan, outline, depth, threadId } = await req.json();
        const primaryModel = config.deepResearch.model;
        const fallbackModel = config.chat.titleGenerationModel;
        const researchOutline = typeof outline === "string" ? outline : "";
        const researchDepth = parseDeepResearchDepth(depth);

        if (!message || !plan || !Array.isArray(plan)) {
            return new NextResponse("Invalid request body", { status: 400 });
        }

        let existingThreadId: string | undefined;
        if (typeof threadId === "string" && threadId.trim()) {
            const normalizedThreadId = threadId.trim();
            const existingThread = await store.getThread(normalizedThreadId);
            if (existingThread && existingThread.userId !== userId) {
                return new NextResponse("Forbidden", { status: 403 });
            }
            existingThreadId = existingThread?.id || normalizedThreadId;
        }

        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();
                let finalReport = "";
                let modelUsed = primaryModel;
                
                try {
                    const runExecution = async (modelId: string) => {
                        logger.info(`Starting deep research execution for: ${message} (model=${modelId})`);
                        const generator = deepResearchService.executeResearch(message, plan, researchOutline, modelId, researchDepth);
                        
                        for await (const event of generator) {
                            const data = JSON.stringify(event);
                            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                            
                            // Service yields type: "final" for the complete report
                            if (event.type === "final") {
                                finalReport = event.content || "";
                                logger.info("[Execute] Received final report, length:", finalReport.length);
                            }
                        }
                    };

                    try {
                        await runExecution(primaryModel);
                    } catch (error) {
                        if (isModelAuthError(error) && fallbackModel !== primaryModel) {
                            modelUsed = fallbackModel;
                            const statusData = JSON.stringify({
                                type: "status",
                                content: `Primary research model authentication failed. Retrying with fallback model: ${fallbackModel}`,
                            });
                            controller.enqueue(encoder.encode(`data: ${statusData}\n\n`));
                            await runExecution(fallbackModel);
                        } else {
                            throw error;
                        }
                    }

                    logger.info("[Execute] Generator complete. Final report length:", finalReport.length);
                    
                    if (finalReport) {
                        logger.info("[Execute] Saving report...");
                        
                        // Generate professional titles from the query
                        logger.info("[Execute] Generating professional titles...");
                        const { shortTitle, fullTitle } = await deepResearchService.generateTitle(message, modelUsed);
                        logger.info("[Execute] Short title:", shortTitle);
                        logger.info("[Execute] Full title:", fullTitle);
                        
                        const reportId = generateId();
                        // Built by keyForUser, so the user id is the first
                        // segment -- which is what lets the report route apply a
                        // prefix ownership check. (Not a claim about the rest of
                        // the bucket: layouts predating keyForUser exist and do
                        // not put the user id first.)
                        const key = keyForUser(
                            userId,
                            "deep-research",
                            `${reportId}.md`,
                        );
                        const reportContent = `# ${fullTitle}\n\n${finalReport}`;

                        let reportRef = "";
                        try {
                            const uploadResult = await putObject(
                                STORAGE_BUCKETS.reports,
                                key,
                                Buffer.from(reportContent, "utf-8"),
                            );
                            if (uploadResult.status === "OK") {
                                reportRef = uploadResult.response;
                            }
                        } catch (e) {
                            logger.error({ err: e }, "Failed to save report to storage");
                        }

                        // Save metadata to the database if configured
                        let savedReport = null;
                        if (isDatabaseConfigured() && reportRef) {
                            try {
                                const deepResearchStore = getDeepResearchStore();
                                savedReport = await deepResearchStore.saveReport({
                                    userId,
                                    userName,
                                    userEmail,
                                    title: shortTitle,
                                    query: message,
                                    reportRef,
                                });
                            } catch (e) {
                                logger.error({ err: e }, "Failed to save report metadata");
                            }
                        }

                        // Save into existing thread when provided; otherwise create a new research thread.
                        try {
                            let targetThreadId = existingThreadId;
                            let existingTargetThread =
                                targetThreadId
                                    ? await store.getThread(targetThreadId)
                                    : null;

                            if (!targetThreadId || !existingTargetThread) {
                                logger.info("[Execute] Creating research thread...");
                                const thread = await store.createThread(
                                    userId,
                                    modelUsed,
                                    undefined,
                                    undefined,
                                    "research",
                                    targetThreadId,
                                    userName,
                                    userEmail,
                                );
                                targetThreadId = thread.id;
                                existingTargetThread = thread;
                                logger.info("[Execute] Thread created:", targetThreadId);
                            }

                            const shouldUpdateTitle =
                                !existingTargetThread ||
                                existingTargetThread.messageCount === 0 ||
                                existingTargetThread.title === "New Chat";

                            await store.updateThread(targetThreadId, {
                                threadType: "research",
                                ...(shouldUpdateTitle ? { title: shortTitle } : {}),
                            });

                            // Add user message (the original query)
                            await store.addMessage(targetThreadId, {
                                threadId: targetThreadId,
                                userId,
                                userName,
                                userEmail,
                                role: "user",
                                content: message,
                                model: modelUsed,
                            });

                            // If a report ref is available, include report reference; otherwise include inline content
                            const reportCreatedAt = savedReport?.createdAt || new Date().toISOString();
                            const assistantContent = reportRef
                                ? "I've completed your research. Feel free to ask me follow-up questions or request changes."
                                : `I've completed your research. Feel free to ask me follow-up questions or request changes.\n\n---\n\n${finalReport}`;

                            await store.addMessage(targetThreadId, {
                                threadId: targetThreadId,
                                userId,
                                userName,
                                userEmail,
                                role: "assistant",
                                content: assistantContent,
                                model: modelUsed,
                                researchReport: reportRef ? {
                                    id: savedReport?.id || reportId,
                                    title: shortTitle,
                                    reportRef: reportRef,
                                    createdAt: reportCreatedAt,
                                } : undefined,
                            });

                            // Send report_saved event with thread info
                            logger.info("[Execute] Sending report_saved event for thread:", targetThreadId);
                            const reportSavedEvent = JSON.stringify({
                                type: "report_saved",
                                reportId: savedReport?.id || reportId,
                                threadId: targetThreadId,
                                title: shortTitle,
                                reportRef: reportRef || "",
                                createdAt: reportCreatedAt,
                            });
                            controller.enqueue(encoder.encode(`data: ${reportSavedEvent}\n\n`));
                            logger.info("[Execute] report_saved event sent!");
                        } catch (e) {
                            logger.error({ err: e }, "[Execute] Failed to create thread");
                        }
                    } else {
                        logger.info("[Execute] No final report to save, skipping thread creation");
                    }

                } catch (error) {
                    logger.error({ err: error }, "Deep Research Stream Error");
                    const errorData = JSON.stringify({ type: "error", error: "Deep research execution failed." });
                    controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
                } finally {
                    controller.close();
                }
            }
        });

        return new NextResponse(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        });

    } catch (error) {
        logger.error({ err: error }, "Deep Research Execute Error");
        return new NextResponse(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { 
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}
