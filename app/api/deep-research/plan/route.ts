
import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { deepResearchService } from "@/lib/langchain/deep-research-service";
import { config } from "@/lib/config";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
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

        const rateLimit = await checkRateLimit(req, {
            namespace: "deep_research_plan",
            identifier: session.user.id,
            ...config.rateLimit.research,
        });
        if (!rateLimit.allowed) {
            return new NextResponse(
                `Too many deep research plan requests. Retry after ${rateLimit.retryAfterSeconds}s`,
                {
                    status: 429,
                    headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
                },
            );
        }

        const { message, depth } = await req.json();
        const researchDepth = parseDeepResearchDepth(depth);

        if (!message) {
            return new NextResponse("Missing message", { status: 400 });
        }

        const primaryModel = config.deepResearch.model;
        const fallbackModel = config.chat.titleGenerationModel;

        let plan;
        try {
            plan = await deepResearchService.planResearch(message, primaryModel, researchDepth);
        } catch (error) {
            if (isModelAuthError(error) && fallbackModel !== primaryModel) {
                logger.warn(`[Deep Research Plan] Primary model auth failed. Retrying with fallback model: ${fallbackModel}`);
                plan = await deepResearchService.planResearch(message, fallbackModel, researchDepth);
            } else {
                throw error;
            }
        }
        
        return NextResponse.json({ ...plan, depth: researchDepth });
    } catch (error) {
        logger.error({ err: error }, "Deep Research Plan Error");
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
