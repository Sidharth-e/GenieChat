import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { logger } from "@/lib/logger";
import type { ServerActionResponse } from "@/lib/types";
import {
  ALL_STORAGE_BUCKETS,
  STORAGE_TTL,
  type StorageBucket,
} from "@/constants/storage";
import { formatRef, parseRef, type StorageRef } from "./ref";

/**
 * The `config.storage` shape, restated here.
 *
 * Restated rather than imported so this module stays free of `@/lib/config`.
 * `s3-client.ts` passes the real `config.storage` in, so TypeScript still
 * rejects a divergence between the two at that call site.
 */
export interface StorageConfig {
  endpoint: string | undefined;
  publicEndpoint: string | undefined;
  region: string;
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
  forcePathStyle: boolean;
}

export interface StorageClients {
  internal: S3Client | null;
  public: S3Client | null;
}

/**
 * True for both a missing object and a missing bucket.
 *
 * The AWS SDK surfaces 404 as `NotFound` (from the head path, e.g. `HeadBucket`)
 * or `NoSuchKey` (from GetObject); `$metadata.httpStatusCode` is the fallback
 * for a response shape we have not seen.
 *
 * A missing *object* never reaches it from a delete; a missing *bucket* does.
 * S3's `DeleteObject` is idempotent and answers 204 for a key that is not there,
 * so `deleteObject` below reports OK for an already-deleted object rather than
 * NOT_FOUND — which leaves a missing bucket as the only delete-side cause, an
 * operational fault rather than a benign re-delete. `deleteObject` says so in its
 * message.
 */
export function isNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;

  const name = (error as { name?: string }).name;
  if (name === "NotFound" || name === "NoSuchKey" || name === "NoSuchBucket") {
    return true;
  }

  return (
    (error as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode === 404
  );
}

function createClient(
  cfg: StorageConfig,
  endpoint: string | undefined,
): S3Client | null {
  if (!endpoint || !cfg.accessKeyId || !cfg.secretAccessKey) {
    return null;
  }

  return new S3Client({
    endpoint,
    region: cfg.region,
    forcePathStyle: cfg.forcePathStyle,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
}

/**
 * Builds the two clients the operations below take as their first argument.
 *
 * They differ only in endpoint: server-side traffic uses the internal one, and
 * presigning uses the public one so the signature matches the Host the browser
 * will actually send.
 *
 * Built once by the caller and passed in rather than built per call, because an
 * `S3Client` holds a connection pool. A `null` here means "not configured" —
 * `S3_ENDPOINT`, the key id or the secret is blank — which every operation
 * below turns into the NOT_CONFIGURED response.
 */
export function createStorageClients(cfg: StorageConfig): StorageClients {
  return {
    internal: createClient(cfg, cfg.endpoint),
    public: createClient(cfg, cfg.publicEndpoint),
  };
}

const NOT_CONFIGURED: ServerActionResponse<never> = {
  status: "ERROR",
  errors: [
    {
      message:
        "Object storage is not configured. Set S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.",
    },
  ],
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Every operation below takes the clients rather than reading configuration, so
// the module has no import that could fail outside Next.js.
export const putObject = async (
  clients: StorageClients,
  bucket: StorageBucket,
  key: string,
  body: Buffer,
): Promise<ServerActionResponse<StorageRef>> => {
  if (!clients.internal) return NOT_CONFIGURED;

  try {
    await clients.internal.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }),
    );

    logger.info(`[Storage] Uploaded s3://${bucket}/${key}`);

    // Returns a ref rather than a URL: nothing about a stored object should be
    // fetchable without a fresh signature.
    return { status: "OK", response: formatRef(bucket, key) };
  } catch (error) {
    logger.error({ err: error }, "[Storage] PutObject failed");
    return {
      status: "ERROR",
      errors: [{ message: `Failed to upload object: ${errorMessage(error)}` }],
    };
  }
};

export const deleteObject = async (
  clients: StorageClients,
  ref: StorageRef,
): Promise<ServerActionResponse<boolean>> => {
  if (!clients.internal) return NOT_CONFIGURED;

  const parsed = parseRef(ref);
  if (!parsed) {
    return {
      status: "ERROR",
      errors: [{ message: `Malformed storage reference: ${ref}` }],
    };
  }

  try {
    await clients.internal.send(
      new DeleteObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }),
    );

    logger.info(`[Storage] Deleted ${ref}`);
    return { status: "OK", response: true };
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        status: "NOT_FOUND",
        errors: [{ message: `Bucket not found: ${parsed.bucket}` }],
      };
    }

    logger.error({ err: error }, "[Storage] DeleteObject failed");
    return {
      status: "ERROR",
      errors: [{ message: `Failed to delete object: ${errorMessage(error)}` }],
    };
  }
};

export const getObject = async (
  clients: StorageClients,
  ref: StorageRef,
): Promise<ServerActionResponse<NodeJS.ReadableStream>> => {
  if (!clients.internal) return NOT_CONFIGURED;

  const parsed = parseRef(ref);
  if (!parsed) {
    return {
      status: "ERROR",
      errors: [{ message: `Malformed storage reference: ${ref}` }],
    };
  }

  try {
    const response = await clients.internal.send(
      new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }),
    );

    if (!response.Body) {
      return {
        status: "ERROR",
        errors: [{ message: `Empty response body for ${ref}` }],
      };
    }

    // In Node the SDK returns a Readable, which is what the consumers expect
    // (`for await (const chunk of …)`, and `streamToString`'s `.on("data")`).
    return {
      status: "OK",
      response: response.Body as unknown as NodeJS.ReadableStream,
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        status: "NOT_FOUND",
        errors: [{ message: `Object not found: ${ref}` }],
      };
    }

    logger.error({ err: error }, "[Storage] GetObject failed");
    return {
      status: "ERROR",
      errors: [{ message: `Failed to read object: ${errorMessage(error)}` }],
    };
  }
};

export const getObjectAsBuffer = async (
  clients: StorageClients,
  ref: StorageRef,
): Promise<ServerActionResponse<Buffer>> => {
  const result = await getObject(clients, ref);
  if (result.status !== "OK") return result;

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of result.response) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    return { status: "OK", response: Buffer.concat(chunks) };
  } catch (error) {
    logger.error({ err: error }, "[Storage] Reading object stream failed");
    return {
      status: "ERROR",
      errors: [{ message: `Failed to read object: ${errorMessage(error)}` }],
    };
  }
};

export const getObjectAsBase64 = async (
  clients: StorageClients,
  ref: StorageRef,
): Promise<ServerActionResponse<string>> => {
  const result = await getObjectAsBuffer(clients, ref);
  if (result.status !== "OK") return result;

  return { status: "OK", response: result.response.toString("base64") };
};

/**
 * Mints a presigned GET URL.
 *
 * Async because `getSignedUrl` is. Every call site is already inside an async
 * function — including the `msg.images.forEach` in `lib/api/stream-helper.ts`,
 * which the call-site conversion turns into a `for...of` so it can await.
 *
 * A TTL beyond the SigV4 maximum throws rather than being capped. Presigning
 * also throws rather than returning a result, because every caller needs a URL
 * and has no useful degraded value.
 */
export const presignGet = async (
  clients: StorageClients,
  ref: StorageRef,
  ttlSeconds: number,
): Promise<string> => {
  if (!clients.public) throw new Error("Object storage is not configured");

  const parsed = parseRef(ref);
  if (!parsed) throw new Error(`Malformed storage reference: ${ref}`);

  if (ttlSeconds > STORAGE_TTL.max) {
    throw new Error(
      `Presigned URL TTL ${ttlSeconds}s exceeds the SigV4 maximum of ${STORAGE_TTL.max}s`,
    );
  }

  // Signed against the public endpoint, not the internal one. SigV4 covers the
  // Host header, so a URL signed for `http://garage:3900` is rejected by a
  // browser that resolved a different name.
  const command = new GetObjectCommand({
    Bucket: parsed.bucket,
    Key: parsed.key,
  });

  return getSignedUrl(clients.public, command, { expiresIn: ttlSeconds });
};

/**
 * Creates any of the five buckets that are missing.
 *
 * Deliberately **not** called at application boot. Storage is an optional
 * dependency that degrades rather than blocking startup, and a boot-time
 * network call to Garage would contradict that. `scripts/check-storage.ts`
 * calls it so an operator runs it explicitly; a missing bucket otherwise
 * surfaces on first use as an error naming the bucket.
 *
 * Returns the buckets it created, so the caller can report them.
 */
export const ensureBuckets = async (
  clients: StorageClients,
): Promise<ServerActionResponse<StorageBucket[]>> => {
  if (!clients.internal) return NOT_CONFIGURED;

  const created: StorageBucket[] = [];
  const unverified: StorageBucket[] = [];

  for (const bucket of ALL_STORAGE_BUCKETS) {
    try {
      await clients.internal.send(new HeadBucketCommand({ Bucket: bucket }));
      continue;
    } catch (error) {
      if (!isNotFoundError(error)) {
        // A permissions or connectivity problem (Garage answers `AccessDenied`
        // when the key lacks ListBucket), not a missing bucket. The bucket's
        // state is now *unknown*, so it must not be counted as verified --
        // `garage-bootstrap.sh` is the thing to check.
        logger.error(
          { err: error },
          `[Storage] HeadBucket failed for ${bucket}`,
        );
        unverified.push(bucket);
        continue;
      }
    }

    try {
      await clients.internal.send(new CreateBucketCommand({ Bucket: bucket }));
      created.push(bucket);
      logger.info(`[Storage] Created bucket ${bucket}`);
    } catch (error) {
      // Garage only auto-grants a key ALL_PERMISSIONS on buckets that key
      // creates, and the bootstrapped key may lack `allow_create_bucket`. The
      // bucket is absent and stays absent, so this is a failure and not a
      // warning -- `garage-bootstrap.sh` is the supported path.
      logger.error(
        { err: error },
        `[Storage] Could not create bucket ${bucket}. Run scripts/garage-bootstrap.sh.`,
      );
      unverified.push(bucket);
    }
  }

  // "OK" means every bucket was confirmed to exist, whether found by the head
  // or created. A bucket whose state could not be established is an error:
  // returning OK for it is what would let this call report "all present"
  // without having checked.
  if (unverified.length > 0) {
    return {
      status: "ERROR",
      errors: [
        { message: `Could not verify or create: ${unverified.join(", ")}` },
      ],
    };
  }

  return { status: "OK", response: created };
};
