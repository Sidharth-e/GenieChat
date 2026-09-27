import { MongoClient } from "mongodb";
import {
  COLLECTION_NAMES,
  INDEX_SPECS,
  describeIndexMismatch,
} from "@/lib/mongodb/indexes";

/**
 * Creates every collection and index the application expects, and is safe to
 * re-run: anything that already exists is reported and skipped.
 *
 * The script reads `process.env` directly rather than going through
 * `config.mongodb`. That is deliberate, and the alternative does not work:
 * `lib/config.ts` opens with `import "server-only"` -- a package Next.js
 * aliases at build time and `vitest.setup.ts` mocks, but which does not resolve
 * at all for a plain Node process -- and it reaches `lib/env.ts`, which parses
 * the whole environment schema at first import. A bootstrap script that only
 * needs `MONGODB_URI` must not require the Azure AD and encryption keys
 * to be present, and must not depend on the app's lazy Mongo singleton having
 * been touched. The two values here are exactly the ones
 * `config.mongodb.uri` and `config.mongodb.databaseName` are built from,
 * including the `"geniechat"` default.
 *
 * `@/lib/mongodb/indexes` is importable precisely because it is pure data with
 * no `lib/env` import.
 */
async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set.");
    process.exit(1);
  }

  const databaseName = process.env.MONGODB_DB_NAME || "geniechat";

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(databaseName);

  const existing = new Set(
    (await db.listCollections().toArray()).map((c) => c.name),
  );

  for (const name of COLLECTION_NAMES) {
    if (existing.has(name)) {
      console.log(`collection exists: ${name}`);
    } else {
      await db.createCollection(name);
      console.log(`created collection: ${name}`);
    }
  }

  for (const spec of INDEX_SPECS) {
    const col = db.collection(spec.collection);

    // One read of the collection's index list, rather than `indexExists`:
    // that call compares the NAME only, so an index whose options have drifted
    // (a TTL of 3600 seconds where the spec says 0, say) would be reported
    // "exists", skipped, and never corrected -- the one place where "idempotent"
    // and "converges to the declared state" come apart.
    const liveIndexes = await col.indexes();
    const live = liveIndexes.find((index) => index.name === spec.name);

    if (!live) {
      await col.createIndex(spec.keys, { ...spec.options, name: spec.name });
      console.log(`created index: ${spec.collection}.${spec.name}`);
      continue;
    }

    const mismatch = describeIndexMismatch(live, spec);
    if (mismatch) {
      // Reported, never repaired. Dropping an index is destructive and briefly
      // unindexes a live query, so a human decides -- this line names the exact
      // difference so that decision is an easy one.
      console.warn(
        `index mismatch: ${spec.collection}.${spec.name} -- ${mismatch}`,
      );
      continue;
    }

    console.log(`index exists: ${spec.collection}.${spec.name}`);
  }

  await client.close();
  console.log(`done (database: ${databaseName})`);
}

main().catch((err) => {
  console.error("setup failed:", err);
  process.exit(1);
});
