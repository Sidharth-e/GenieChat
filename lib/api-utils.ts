import { NextResponse } from "next/server";
import { logger } from "./logger";

/**
 * Custom API error class that includes HTTP status code.
 */
export class ApiError extends Error {
    readonly status: number;
    readonly code?: string;

    constructor(message: string, status: number, code?: string) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.code = code;
    }
}

/**
 * Standard API response format for errors.
 */
export interface ApiErrorResponse {
    error: string;
    code?: string;
}

/**
 * API response utilities namespace.
 */
export const api = {
    /**
     * Returns a success response with data.
     */
    success<T>(data: T, status = 200): NextResponse<T> {
        return NextResponse.json(data, { status });
    },

    /**
     * Returns a created (201) response.
     */
    created<T>(data: T): NextResponse<T> {
        return NextResponse.json(data, { status: 201 });
    },

    /**
     * Returns a generic error response.
     */
    error(message: string, status: number, code?: string): NextResponse<ApiErrorResponse> {
        const response: ApiErrorResponse = { error: message };
        if (code) response.code = code;
        return NextResponse.json(response, { status });
    },

    /**
     * Returns a 400 Bad Request response.
     */
    badRequest(message: string): NextResponse<ApiErrorResponse> {
        return NextResponse.json({ error: message }, { status: 400 });
    },

    /**
     * Returns a 401 Unauthorized response.
     */
    unauthorized(message = "Unauthorized"): NextResponse<ApiErrorResponse> {
        return NextResponse.json({ error: message }, { status: 401 });
    },

    /**
     * Returns a 403 Forbidden response.
     */
    forbidden(message = "Forbidden"): NextResponse<ApiErrorResponse> {
        return NextResponse.json({ error: message }, { status: 403 });
    },

    /**
     * Returns a 404 Not Found response.
     */
    notFound(resource?: string): NextResponse<ApiErrorResponse> {
        const message = resource ? `${resource} not found` : "Not found";
        return NextResponse.json({ error: message }, { status: 404 });
    },

    /**
     * Returns a 500 Internal Server Error response.
     */
    serverError(message = "Internal server error"): NextResponse<ApiErrorResponse> {
        return NextResponse.json({ error: message }, { status: 500 });
    },

    /**
     * Returns a 429 Too Many Requests response.
     */
    tooManyRequests(
        message = "Too many requests",
        retryAfterSeconds?: number
    ): NextResponse<ApiErrorResponse> {
        const headers =
            retryAfterSeconds != null
                ? { "Retry-After": String(retryAfterSeconds) }
                : undefined;
        return NextResponse.json({ error: message }, { status: 429, headers });
    },

    /**
     * Returns a 503 Service Unavailable response. 
     */
    serviceUnavailable(message = "Service unavailable"): NextResponse<ApiErrorResponse> {
        return NextResponse.json({ error: message }, { status: 503 });
    },
};

/**
 * Handles errors in API catch blocks with consistent logging and response.
 * @param error - The caught error
 * @param context - Optional context string for logging (e.g., "Create thread")
 */
export function handleError(
    error: unknown,
    context?: string
): NextResponse<ApiErrorResponse> {
    const prefix = context ? `${context} error:` : "API error:";

    if (error instanceof ApiError) {
        logger.error({ err: error.message }, prefix);
        return api.error(error.message, error.status, error.code);
    }

    if (error instanceof Error) {
        logger.error({ err: error }, prefix);
        return api.serverError(`Failed to ${context?.toLowerCase() || "process request"}`);
    }

    logger.error({ err: error }, prefix);
    return api.serverError();
}

/**
 * Utility to check authentication and return unauthorized response if needed.
 * @returns The user if authenticated, or calls the response handler
 */
export function requireAuth<T>(
    user: T | null | undefined
): user is T {
    return user != null;
}

/**
 * Utility to check if a store/service is available.
 */
export function requireService<T>(
    service: T | null | undefined
): service is T {
    return service != null;
}
