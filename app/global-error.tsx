"use client";

import { logger } from "@/lib/logger";
import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface GlobalErrorProps {
    error: Error & { digest?: string };
    reset: () => void;
}

/**
 * Global error boundary for the root layout.
 * Catches errors that occur in the root layout or its children.
 * Note: This component must define its own <html> and <body> tags
 * as it replaces the root layout when an error occurs.
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
    useEffect(() => {
        // Log critical error to monitoring service
        logger.error("Critical application error:", error);
    }, [error]);

    return (
        <html lang="en" className="dark">
            <body className="font-sans antialiased bg-background text-foreground">
                <div className="flex h-screen flex-col items-center justify-center p-8">
                    <div className="mx-auto max-w-md text-center">
                        <div className="mb-6 flex justify-center">
                            <div className="rounded-full bg-red-500/10 p-4">
                                <AlertTriangle className="h-12 w-12 text-red-500" />
                            </div>
                        </div>

                        <h1 className="mb-2 text-2xl font-bold">
                            Critical Error
                        </h1>

                        <p className="mb-6 text-text-secondary">
                            A critical error has occurred. Please refresh the
                            page to continue.
                        </p>

                        {error.digest && (
                            <p className="mb-6 font-mono text-xs text-text-secondary">
                                Error ID: {error.digest}
                            </p>
                        )}

                        <button
                            onClick={reset}
                            className="inline-flex items-center gap-2 rounded-lg bg-foreground px-6 py-3 font-medium text-background transition-colors hover:bg-foreground/90"
                        >
                            <RefreshCw className="h-4 w-4" />
                            Refresh Page
                        </button>
                    </div>
                </div>
            </body>
        </html>
    );
}
