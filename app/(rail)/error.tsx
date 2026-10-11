"use client";

import { logger } from "@/lib/logger";
import { useEffect } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface ErrorProps {
    error: Error & { digest?: string };
    reset: () => void;
}

/**
 * Error boundary component for the main app section.
 * Catches runtime errors and provides recovery options.
 */
export default function Error({ error, reset }: ErrorProps) {
    useEffect(() => {
        // Log error to monitoring service
        logger.error("Application error:", error);
    }, [error]);

    return (
        <div className="flex h-full min-h-[400px] flex-col items-center justify-center p-8">
            <div className="mx-auto max-w-md text-center">
                <div className="mb-6 flex justify-center">
                    <div className="rounded-full bg-destructive/10 p-4">
                        <AlertTriangle className="h-12 w-12 text-destructive" />
                    </div>
                </div>

                <h2 className="mb-2 text-2xl font-bold text-foreground">
                    Something went wrong
                </h2>

                <p className="mb-6 text-muted-foreground">
                    An unexpected error occurred. Please try again or return to
                    the home page.
                </p>

                {error.digest && (
                    <p className="mb-6 font-mono text-xs text-muted-foreground">
                        Error ID: {error.digest}
                    </p>
                )}

                <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
                    <Button
                        onClick={reset}
                        className="gap-2"
                        variant="default"
                    >
                        <RefreshCw className="h-4 w-4" />
                        Try Again
                    </Button>

                    <Button variant="outline" asChild className="gap-2">
                        <Link href="/">
                            <Home className="h-4 w-4" />
                            Go Home
                        </Link>
                    </Button>
                </div>
            </div>
        </div>
    );
}
