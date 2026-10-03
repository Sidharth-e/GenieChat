import { ALL_STORAGE_BUCKETS } from "../constants/storage";
import {
  createStorageClients,
  deleteObject,
  ensureBuckets,
  getObjectAsBuffer,
  presignGet,
  putObject,
} from "../lib/storage/s3-core";

/**
 * Reads `process.env` directly rather than importing `@/lib/config`, for the
 * reason `setup-mongodb.ts` documents in its own header: `lib/config.ts` is
 * guarded by `server-only`, a Next.js build-time alias that does not resolve in
 * a plain `tsx` process, and it reaches `lib/env.ts`, which validates the whole
 * environment schema. A storage check must depend on the S3 variables alone, so
 * that an unrelated blank optional var in `.env` cannot stop it from running.
 *
 * Importing `s3-core` rather than `s3-client` is what makes this possible --
 * `s3-client` is the module that reaches `@/lib/config`.
 */
const clients = createStorageClients({
  endpoint: process.env.S3_ENDPOINT,
  publicEndpoint: process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "garage",
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
});

const KEY = `storage-check/${Date.now()}.txt`;
const BODY = "geniechat storage check";

async function main() {
  if (!process.env.S3_ENDPOINT) {
    console.error(
      "S3_ENDPOINT is not set. This script reads it from the environment; the\n" +
        "`storage:check` pnpm script loads `.env` for you.",
    );
    process.exit(1);
  }

  const bucket = ALL_STORAGE_BUCKETS[0];
  let failures = 0;

  const report = (name: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures += 1;
  };

  // Reports which of the five buckets it had to create, so a missing-bucket
  // problem is diagnosed here rather than on a user's first upload.
  const buckets = await ensureBuckets(clients);
  report(
    "ensureBuckets",
    buckets.status === "OK",
    buckets.status === "OK"
      ? buckets.response.length
        ? `created: ${buckets.response.join(", ")}`
        : "all already present"
      : JSON.stringify(buckets.errors),
  );

  const put = await putObject(clients, bucket, KEY, Buffer.from(BODY, "utf-8"));
  report("putObject", put.status === "OK", put.status === "OK" ? put.response : JSON.stringify(put.errors));
  if (put.status !== "OK") return finish(failures);

  const url = await presignGet(clients, put.response, 3600);
  report("presignGet", url.startsWith("http"));

  const fetched = await fetch(url);
  report("presigned GET", fetched.ok, `HTTP ${fetched.status}`);
  report("round-trip body", (await fetched.text()) === BODY);

  const buffer = await getObjectAsBuffer(clients, put.response);
  report("getObjectAsBuffer", buffer.status === "OK" && buffer.response.toString("utf-8") === BODY);

  const first = await deleteObject(clients, put.response);
  report("deleteObject", first.status === "OK", first.status);

  // S3's DeleteObject is idempotent: a key that is not there still answers 204,
  // so this reports OK rather than NOT_FOUND. Asserting NOT_FOUND here would
  // assert semantics S3 does not have.
  const second = await deleteObject(clients, put.response);
  report("deleteObject on missing → OK (S3 delete is idempotent)", second.status === "OK", second.status);

  // The missing-object NOT_FOUND path, on the verb that reaches it: GetObject
  // answers NoSuchKey, which is what `isNotFoundError` exists to classify.
  const gone = await getObjectAsBuffer(clients, put.response);
  report("getObjectAsBuffer on missing → NOT_FOUND", gone.status === "NOT_FOUND", gone.status);

  finish(failures);
}

function finish(failures: number) {
  console.log(failures === 0 ? "\nAll storage checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
