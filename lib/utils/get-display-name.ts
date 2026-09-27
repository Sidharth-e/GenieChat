"use client";

import { useAuthStore } from "@/lib/auth";

/**
 * Hook to get the display name for a message sender.
 * For user messages, it returns the authenticated user's name or "You" as fallback.
 * For assistant messages, it returns the provided assistant name.
 */
export function useDisplayName() {
    const user = useAuthStore((state) => state.user);

    const getDisplayName = (isUser: boolean, assistantName: string = "Assistant") => {
        if (isUser) {
            return user?.name || "You";
        }
        return assistantName;
    };

    return { getDisplayName, userName: user?.name || "You" };
}
