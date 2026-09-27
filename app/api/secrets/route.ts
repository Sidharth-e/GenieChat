import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { SecretStore } from "@/lib/mongodb/secret-store";
import { isDatabaseConfigured, config } from "@/lib/config";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { z } from "zod";

function getSecretStore() {
  if (isDatabaseConfigured() && env.SECRET_ENCRYPTION_KEY) {
    return new SecretStore();
  }
  return null;
}

const createSecretSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_:-]+$/),
  value: z.string().min(1).max(4096),
  description: z.string().max(256).optional(),
});

function maskSecretValue(value: string): string {
  if (!value) return "";
  return "*".repeat(Math.min(24, Math.max(8, value.length)));
}

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();

    const rateLimit = await checkRateLimit(request, {
      namespace: "secrets_read",
      identifier: user.id,
      ...config.rateLimit.download,
    });
    if (!rateLimit.allowed) {
      return api.tooManyRequests(
        `Too many secret read requests. Retry after ${rateLimit.retryAfterSeconds}s`,
        rateLimit.retryAfterSeconds,
      );
    }

    const secretStore = getSecretStore();
    if (!secretStore)
      return api.serviceUnavailable("Secret store not configured");

    const secrets = await secretStore.getSecrets(user.id);
    const maskedSecrets = secrets.map((secret) => ({
      ...secret,
      value: maskSecretValue(secret.value),
    }));

    return api.success(maskedSecrets);
  } catch (error) {
    return handleError(error, "Fetch secrets");
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();

    const rateLimit = await checkRateLimit(request, {
      namespace: "secrets_write",
      identifier: user.id,
      ...config.rateLimit.medium,
    });
    if (!rateLimit.allowed) {
      return api.tooManyRequests(
        `Too many secret write requests. Retry after ${rateLimit.retryAfterSeconds}s`,
        rateLimit.retryAfterSeconds,
      );
    }

    const secretStore = getSecretStore();
    if (!secretStore)
      return api.serviceUnavailable("Secret store not configured");

    const parsed = createSecretSchema.safeParse(await request.json());
    if (!parsed.success) {
      return api.badRequest("Invalid secret payload");
    }

    const { name, value, description } = parsed.data;

    const secret = await secretStore.createSecret({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      name,
      value,
      description: description || "",
    });

    return api.created({
      ...secret,
      value: maskSecretValue(secret.value),
    });
  } catch (error) {
    return handleError(error, "Create secret");
  }
}
