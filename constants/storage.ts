/**
 * Object-storage bucket names and presigned-URL lifetimes.
 *
 * Bucket names are part of the persisted contract: a reference stored in
 * MongoDB names one of these, so renaming one orphans every object inside it.
 */
export const STORAGE_BUCKETS = {
  chatDocuments: "chat-documents",
  chatImages: "chat-images",
  reports: "reports",
  agentDocuments: "agent-documents",
  generatedImages: "generated-images",
  artifacts: "artifacts",
} as const;

export type StorageBucket =
  (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS];

export const ALL_STORAGE_BUCKETS: readonly StorageBucket[] =
  Object.values(STORAGE_BUCKETS);

/**
 * Presigned-URL lifetimes in seconds.
 *
 * `max` is the SigV4 ceiling of 604800 (7 days) — S3 presigning cannot exceed it.
 */
export const STORAGE_TTL = {
  /** Chat attachments and pending-attachment previews. */
  attachment: 60 * 60 * 24,
  /** Download-proxy redirects, which the browser follows immediately. */
  download: 60 * 60,
  /** Long-lived links. The SigV4 maximum. */
  max: 604800,
} as const;
