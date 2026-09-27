import { z } from "zod";
import {
  ALL_STORAGE_BUCKETS,
  type StorageBucket,
} from "@/constants/storage";

/**
 * A reference to a stored object, shaped `s3://<bucket>/<key>`.
 *
 * This is the only form written to MongoDB. It is a locator, not a credential:
 * possessing one grants no access, unlike the signed Azure SAS URLs it
 * replaces, where a leaked database row was a leaked capability.
 */
export type StorageRef = string;

const REF_SCHEME = "s3://";

export interface ParsedStorageRef {
  bucket: StorageBucket;
  key: string;
}

export function isStorageBucket(value: string): value is StorageBucket {
  return (ALL_STORAGE_BUCKETS as readonly string[]).includes(value);
}

export function isStorageRef(value: unknown): value is StorageRef {
  return typeof value === "string" && value.startsWith(REF_SCHEME);
}

/**
 * Builds the canonical ref for a bucket and key.
 *
 * A leading `/` on `key` is stripped so the result is always
 * `s3://<bucket>/<key>`. An empty key is not rejected: `formatRef(b, "")` gives
 * `s3://b/`, which `parseRef` returns `null` for. Do not pass one — a ref that
 * cannot be parsed back is a silent read failure later.
 */
export function formatRef(bucket: StorageBucket, key: string): StorageRef {
  return `${REF_SCHEME}${bucket}/${key.replace(/^\/+/, "")}`;
}

/**
 * Parses a ref into its bucket and key.
 *
 * Returns `null` rather than throwing for anything malformed, including an
 * unrecognised bucket — the bucket allowlist is the first half of the
 * authorization check, so an unknown bucket is a rejection, not a lookup.
 * The key is deliberately not percent-decoded: keys are stored as written.
 */
export function parseRef(ref: string): ParsedStorageRef | null {
  if (!isStorageRef(ref)) return null;

  const withoutScheme = ref.slice(REF_SCHEME.length);
  const separator = withoutScheme.indexOf("/");
  if (separator === -1) return null;

  const bucket = withoutScheme.slice(0, separator);
  const key = withoutScheme.slice(separator + 1);

  if (!key) return null;
  if (!isStorageBucket(bucket)) return null;

  return { bucket, key };
}

/**
 * Builds a key under the owning user.
 *
 * Keys built here follow `${userId}/…`, which is what lets ownership be a
 * single check (`isUserScopedKey`) rather than a prefix test per call site.
 * That uniformity is a property of this constructor, not of every key already
 * in the buckets: layouts predating it exist and do not put the user id first.
 *
 * Segments are joined as given, minus empty ones. A segment containing `/` or
 * `..` is deliberately not sanitised — it is not an ownership bypass, because
 * `isUserScopedKey` sees the literal key and S3 treats that byte string as an
 * opaque name. It would only bite code that normalises the path while building
 * a URL, which is a reason not to do that.
 */
export function keyForUser(userId: string, ...segments: string[]): string {
  return [userId, ...segments.filter((segment) => segment.length > 0)].join("/");
}

/**
 * True when `key` sits under `${userId}/`.
 *
 * The trailing slash matters: without it, user `u1` would match user `u10`'s
 * keys.
 */
export function isUserScopedKey(key: string, userId: string): boolean {
  return key.startsWith(`${userId}/`);
}

/** Validates a ref arriving from a client, e.g. in a request body. */
export const storageRefSchema = z
  .string()
  .max(2048)
  .refine(isStorageRef, { message: "Not a valid storage reference" });
