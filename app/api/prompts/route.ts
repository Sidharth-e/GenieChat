import { NextRequest } from "next/server";
import { PromptStore } from "@/lib/mongodb/prompt-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

const promptStore = isDatabaseConfigured() ? new PromptStore() : null;

export async function GET() {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();
        if (!promptStore) return api.serviceUnavailable("Database not configured");

        const prompts = await promptStore.getPrompts(user.id);
        return api.success(prompts);
    } catch (error) {
        return handleError(error, "Fetch prompts");
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();
        if (!promptStore) return api.serviceUnavailable("Database not configured");

        const rateLimit = await checkRateLimit(request, {
            namespace: "prompts_write",
            identifier: user.id,
            ...config.rateLimit.standard,
        });
        if (!rateLimit.allowed) {
            return api.tooManyRequests(
                `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s`,
                rateLimit.retryAfterSeconds,
            );
        }

        const body = await request.json();
        const { title, content, tags } = body;

        if (!title || !content) return api.badRequest("Title and content are required");

        const variableMatches = content.match(/\{\{(\w+)\}\}/g) || [];
        const variables = variableMatches.map((v: string) => v.replace(/[{}]/g, ""));

        const prompt = await promptStore.createPrompt({
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
            title,
            content,
            variables,
            tags: tags || [],
        });

        return api.created(prompt);
    } catch (error) {
        return handleError(error, "Create prompt");
    }
}
