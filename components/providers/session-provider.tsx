"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/lib/auth";

interface SessionProviderProps {
    children: React.ReactNode;
}

function AuthInitializer({ children }: { children: React.ReactNode }) {
    const initialize = useAuthStore((state) => state.initialize);

    useEffect(() => {
        initialize();
    }, [initialize]);

    return <>{children}</>;
}

export function SessionProvider({ children }: SessionProviderProps) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: 60 * 1000,
                        gcTime: 5 * 60 * 1000,
                        retry: 2,
                        refetchOnWindowFocus: false,
                    },
                },
            })
    );

    return (
        <QueryClientProvider client={queryClient}>
            <NextAuthSessionProvider>
                <AuthInitializer>{children}</AuthInitializer>
            </NextAuthSessionProvider>
        </QueryClientProvider>
    );
}
