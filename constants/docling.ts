/**
 * docling-serve tuning: the values the **application** sends.
 *
 * No container-side setting is duplicated here — not `DOCLING_SERVE_MAX_NUM_PAGES`,
 * `DOCLING_SERVE_MAX_FILE_SIZE`, `DOCLING_SERVE_MAX_SYNC_WAIT`,
 * `DOCLING_SERVE_ENG_LOC_NUM_WORKERS`, `DOCLING_SERVE_ENG_LOC_SHARE_MODELS`,
 * `OMP_NUM_THREADS` or `UVICORN_WORKERS`. The service enforces them, the app
 * never sends them, and a constant with no reader is dead code. They live in
 * `docker-compose.yml` with their rationale. The list is illustrative, not the
 * complete set: anything the service sets for itself belongs in that file.
 *
 * See docs/superpowers/specs/2026-09-24-docling-document-parsing-design.md §5.
 */

/**
 * TableFormer mode. The default is `accurate`; `fast` is chosen because the app
 * has never had table extraction at all, so `fast` is already a strict
 * improvement over the previous flat-paragraph output.
 */
export const DOCLING_TABLE_MODE = "fast" as const;

/**
 * Sent per request as `document_timeout`. The service aborts a conversion past
 * this and returns **no content at all** — but not an error response. Measured
 * on a cap-sized PDF with only this value varied: HTTP 200, `status:
 * "partial_success"`, `errors: []`, every content field empty and zero pages
 * returned, reproduced at 2s, 30s and 70s; a control run of the same file at a
 * longer timeout succeeded, so the timeout is the cause. The service logs a
 * WARNING, not an ERROR.
 *
 * **The status alone therefore does not identify a timeout.** The app reports
 * one only because the response carries no text — the `markdown.length === 0`
 * guard in `lib/docling/response.ts`, which is load-bearing rather than
 * defensive. The same status is what a page-level partial would report, so
 * neither the app nor the notice rendered from `partial` may read
 * `partial_success` as "some pages failed to convert".
 *
 * The page cap that keeps requests under it is on the container
 * (`DOCLING_SERVE_MAX_NUM_PAGES`), and it is **memory**, not time, that sets it
 * — see the compose comment for the measurement. Measured, a born-digital
 * document at the cap converts in 76.1s and 78.2s across runs, well inside this
 * bound; a concurrent pair measured 173.6s at the 100-page cap and 226.6s at 75
 * — 2.3x and 2.8x one-up, also inside it. One 75-page pair on record took 908s
 * and 910s per request, which is not inside it: that pair is unexplained, an
 * order of magnitude beyond the ~±20% spread the one-up repeats show, and it did
 * not reproduce (a later run of the same probe at the same cap measured 226.6s).
 * If it did recur under this timeout — the one the app sends per request — the
 * conversion is ended here by the service rather than by the app's AbortSignal,
 * which is the ordering working as designed. Wall clock on a development host is
 * noisy, so a slower conversion is a symptom to investigate rather than
 * something to absorb here.
 *
 * A scanned document exceeds the bound instead — the cap cannot distinguish
 * scanned from digital, which is what this timeout is for.
 */
export const DOCLING_DOCUMENT_TIMEOUT_S = 300;
