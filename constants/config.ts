export const DOCUMENT_MAX_UPLOAD_DOCUMENT_SIZE = 20 * 1024 * 1024; // 20MB
export const RAG_MAX_UPLOAD_DOCUMENT_SIZE = 100000000; // 100MB

/**
 * How many versions one assistant message may accumulate.
 *
 * Regeneration appends a version rather than replacing one, so without a bound
 * a single message grows without limit — and every version is carried in the
 * thread document, re-read on each load. Five is the working number: enough to
 * explore alternates without turning one turn into an unbounded record.
 *
 * Enforced server-side in the stream pipeline (the authority, and the place
 * that avoids spending model tokens on a refused regeneration) and mirrored in
 * the UI, which disables the control at the boundary.
 */
export const MAX_MESSAGE_VERSIONS = 5;

/**
 * Approximate token ceiling for a document extract inlined into a chat turn.
 *
 * The chat path inlines the whole extract under `--- Attached Documents ---`
 * with no other size limit, so a document within the upload cap can still
 * consume the context window before the model answers. The full extract is
 * persisted to object storage, so this governs the prompt, not what is retained.
 *
 * Calibrated against `CHARS_PER_TOKEN` (4), which is measured for prose: 100,000
 * tokens keeps ~400,000 characters. It is a soft guard, not a guarantee — a
 * digit-dense extract tokenises at ~1.45 characters per token, so the same
 * budget admits roughly 2.8x its nominal tokens for such a document. The upload
 * cap (`DOCUMENT_MAX_UPLOAD_DOCUMENT_SIZE`) bounds the file, this budget bounds
 * the extract.
 */
export const DOCUMENT_PROMPT_TOKEN_BUDGET = 100000;

