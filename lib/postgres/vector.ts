/**
 * node-postgres serialises a JS array as a Postgres array literal (`{1,2,3}`),
 * which pgvector cannot read. A vector must be sent as the string `[1,2,3]`
 * and cast with `::vector` in the query.
 */
export function toVectorLiteral(embedding: number[]): string {
  for (const value of embedding) {
    if (!Number.isFinite(value)) {
      throw new Error("Embedding contains a non-finite value");
    }
  }
  return `[${embedding.join(",")}]`;
}
