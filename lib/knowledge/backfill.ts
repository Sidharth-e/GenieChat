import { CHAT_DOCUMENT_ATTRIBUTE } from "@/constants/knowledge";

/**
 * The pure half of the backfill migration, kept out of `scripts/backfill-chunks.ts`
 * so it can be tested: the script runs under `tsx` against a live Mongo and
 * Postgres, and it is the paging and the verification that decide whether the
 * migration is complete.
 */

/**
 * One page of the migration's read.
 *
 * Paging is by `_id`, the only field the read may order by that cannot change
 * under it. `generateId()` is a uuidv7, so ascending `_id` is also oldest-first,
 * which makes a partly-migrated corpus progress in the order a reader would
 * expect.
 *
 * The bound is what makes the read resumable. Without it a second page re-reads
 * the first, and a corpus larger than one page is never fully migrated -- which
 * is a silent failure, because every run still reports success.
 */
export function buildBackfillPageQuery(
  afterId?: string,
): Record<string, unknown> {
  return {
    type: CHAT_DOCUMENT_ATTRIBUTE,
    isDeleted: false,
    ...(afterId ? { _id: { $gt: afterId } } : {}),
  };
}

export interface BackfilledDocument {
  id: string;
  name?: string;
  /** Chunks the backfill actually wrote for this document. */
  indexed: number;
  /**
   * `ChatDocument.numberOfIndexes`, the count recorded when the document was
   * first indexed. Absent for documents that predate the field.
   */
  recorded?: number;
}

export interface IndexCountMismatch {
  id: string;
  name?: string;
  indexed: number;
  recorded: number | null;
}

/**
 * The verification Spec §9 step 4 asks for: which documents ended up holding a
 * different number of chunks than were recorded for them.
 *
 * A document with no recorded count is reported too. It cannot be confirmed
 * either way, and reporting it is the point -- leaving it out would make an
 * unverifiable document indistinguishable from a verified one, and this list is
 * the only signal the operator gets that the migration did what it claimed.
 */
export function findIndexCountMismatches(
  documents: BackfilledDocument[],
): IndexCountMismatch[] {
  return documents
    .filter((document) => document.recorded !== document.indexed)
    .map((document) => ({
      id: document.id,
      name: document.name,
      indexed: document.indexed,
      recorded: document.recorded ?? null,
    }));
}
