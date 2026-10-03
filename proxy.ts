import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// Paths that don't require authentication
//
// The schedule tick is here because its caller is an external cron with no
// NextAuth session; it authenticates with a `CRON_SECRET` bearer instead, and
// answers 401 when that secret is unset or wrong. Reachable is not the same as
// unauthenticated — the route's own check is the whole gate.
//
// Entries are prefix-matched, which is why the dispatch seam gets its own
// namespace below rather than a path under an existing one.
const publicPaths = [
  "/login",
  "/api/auth",
  "/api/agents/v1",
  "/api/auto/poll",
  "/api/auto/result",
  "/api/schedules/tick",
  // The dispatch seam. Same caller as the tick — an external worker with a
  // `CRON_SECRET` bearer and no session — and the same reasoning: reachable is
  // not unauthenticated, and the guard in the route is the whole gate.
  //
  // The path is `/api/schedules/execute/...` rather than the spec's
  // `/api/schedules/runs/.../execute` because this list is prefix-matched:
  // exempting `/api/schedules/runs/` would also exempt the session-scoped
  // `GET /api/schedules/runs/[runId]` beside it. Keeping the seam in a namespace
  // of its own is what avoids that today -- but the match is still a prefix, so a
  // session-scoped route added *under* `/api/schedules/execute/` would be exempted
  // just as silently. What protects this namespace is convention, not mechanism.
  "/api/schedules/execute",
];
const STATIC_ASSET_PATH =
  /\/[^/]+\.(?:avif|bmp|css|csv|eot|gif|ico|jpeg|jpg|js|json|map|mp3|mp4|mjs|otf|pdf|png|svg|txt|wav|webm|webmanifest|webp|woff|woff2|xml)$/i;

// Check if the path is public
function isPublicPath(pathname: string): boolean {
  return publicPaths.some((path) => pathname.startsWith(path));
}

// Webhook trigger endpoints use secret-based auth, not session auth
function isWebhookTriggerPath(pathname: string): boolean {
  return /^\/api\/webhooks\/[^/]+\/trigger$/.test(pathname);
}

function isStaticAssetPath(pathname: string): boolean {
  // Match common static file extensions only on the final URL segment.
  return STATIC_ASSET_PATH.test(pathname);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths and webhook trigger endpoints (secret-based auth)
  if (isPublicPath(pathname) || isWebhookTriggerPath(pathname)) {
    return NextResponse.next();
  }

  // Allow static files and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    isStaticAssetPath(pathname)
  ) {
    return NextResponse.next();
  }

  // Check for authentication
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // Redirect to login if not authenticated
  if (!token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|public/).*)",
  ],
};
