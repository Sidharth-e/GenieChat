import { NextRequest } from "next/server";
import { store } from "@/lib/store";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();

        const { id } = await params;
        const thread = await store.getThread(id);

        if (!thread) return api.notFound("Thread");
        if (thread.userId !== user.id) return api.forbidden();

        const messages = await store.getMessages(id);
        return api.success(messages);
    } catch (error) {
        return handleError(error, "Get messages");
    }
}
