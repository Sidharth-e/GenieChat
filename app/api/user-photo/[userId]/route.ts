import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { UserStore } from "@/lib/mongodb/user-store";

// GitHub ids are numeric, so the Graph GUID test this route used to run would
// reject every real id. A length ceiling is the cheap guard that survives: it
// keeps an oversized path segment from reaching the store lookup.
const MAX_USER_ID_LENGTH = 64;

const userStore = isDatabaseConfigured() ? new UserStore() : null;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return new Response(null, { status: 401 });
  }

  const rateLimit = await checkRateLimit(request, {
    namespace: "user_photo",
    ...config.rateLimit.photo,
  });
  if (!rateLimit.allowed) {
    return new Response(null, { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } });
  }

  const { userId } = await params;

  if (!userId || userId.length > MAX_USER_ID_LENGTH) {
    return new Response(null, { status: 400 });
  }

  if (!userStore) {
    return new Response(null, { status: 404 });
  }

  const user = await userStore.getUser(userId);

  if (!user?.image) {
    return new Response(null, { status: 404 });
  }

  // `image` is GitHub's `avatar_url`, written by the sign-in flow and never
  // client-supplied, so redirecting to it serves the same bytes the Graph route
  // used to proxy without re-fetching them on every request. A stored value
  // that is not an absolute URL gets the same not-found answer the Graph
  // catch block returned rather than a 500 from `Response.redirect`.
  let avatarUrl: URL;

  try {
    avatarUrl = new URL(user.image);
  } catch {
    return new Response(null, { status: 404 });
  }

  return Response.redirect(avatarUrl, 307);
}
