import NextAuth from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/config";

export const dynamic = "force-dynamic";

const handler = NextAuth(authOptions);

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
} as const;

function isSessionEndpoint(pathname: string): boolean {
  return pathname.endsWith("/api/auth/session") || pathname.endsWith("/session");
}

function sanitizeSessionPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const session = { ...(payload as Record<string, unknown>) };
  return session;
}

function jsonResponse(body: unknown, status = 200, extraHeaders?: Headers): NextResponse {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json");
  for (const [k, v] of Object.entries(NO_CACHE_HEADERS)) {
    headers.set(k, v);
  }
  headers.delete("content-length");
  return new NextResponse(JSON.stringify(body), { status, headers });
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> },
) {
  let response: Response;
  try {
    response = await handler(req, context as never);
  } catch {
    if (isSessionEndpoint(req.nextUrl.pathname)) {
      return jsonResponse({});
    }
    return jsonResponse({ error: "Internal server error" }, 500);
  }

  if (!isSessionEndpoint(req.nextUrl.pathname)) {
    return response;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return jsonResponse({});
  }

  try {
    const payload = await response.clone().json();
    return jsonResponse(sanitizeSessionPayload(payload), response.status, response.headers);
  } catch {
    return jsonResponse({});
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> },
) {
  try {
    return await handler(req, context as never);
  } catch {
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}
