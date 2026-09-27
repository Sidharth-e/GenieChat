"use client";

import { useEffect } from "react";
import { useThreadsStore } from "@/lib/stores";

export function useThreads() {
    const {
        threads,
        isLoading,
        error,
        fetchThreads,
        deleteThread,
        toggleBookmark,
        renameThread,
        shareThread,
    } = useThreadsStore();

    useEffect(() => {
        fetchThreads();
    }, [fetchThreads]);

    return {
        threads,
        isLoading,
        error,
        fetchThreads,
        deleteThread,
        toggleBookmark,
        renameThread,
        shareThread,
    };
}

