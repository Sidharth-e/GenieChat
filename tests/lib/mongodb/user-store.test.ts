import { describe, it, expect } from "vitest";
import type { WithId } from "mongodb";
import type { UserDocument } from "@/lib/mongodb/common";
import type { UserRecord } from "@/lib/mongodb/user-store";

/**
 * Unit tests for `toUserRecord`, the one pure function in
 * `lib/mongodb/user-store.ts`.
 *
 * Scope is deliberately that function only. The store's own methods are
 * I/O-bound (`findOne`/`replaceOne`/`insertOne` against Mongo), which CLAUDE.md
 * classifies as an integration-test candidate rather than something to
 * unit-test with mocks.
 */

// Importing the store reaches `lib/env.ts` eagerly, through `./client` ->
// `@/lib/config`, and that module parses `process.env` at load time and throws
// when the required key is missing. Vitest does not load `.env` into
// `process.env`, so the key is stubbed before the import; neither helper under
// test reads it, and a real value already present is kept. The type imports
// above are erased at compile time, so they do not trigger the module load; the
// dynamic import below does.
process.env.MONGODB_URI ??= "mongodb://test.invalid:27017";

const { toUserRecord } = await import("@/lib/mongodb/user-store");

/**
 * A stored user document as the driver hands it back from `findOne`: `_id`
 * populated by the insert, every other field as `upsertUser` wrote it. Built by
 * a factory so the shape lives in one place (CLAUDE.md).
 */
function userDoc(
  overrides: Partial<WithId<UserDocument>> = {},
): WithId<UserDocument> {
  return {
    _id: "0193f0aa-0000-7000-8000-000000000001",
    userId: "0193f0aa-0000-7000-8000-000000000001",
    email: "ada@example.com",
    name: "Ada Lovelace",
    image: "https://example.com/ada.png",
    role: "member",
    type: "user",
    lastLoginAt: "2026-06-01T09:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
    ...overrides,
  };
}

/**
 * The other of the two spellings this store can produce: a document with no
 * `image` key at all. Cosmos dropped an `undefined` field on serialisation, so
 * documents written before the migration read back this way, while the Mongo
 * driver stores the same `undefined` as `null`. Nothing queries `image`, and
 * both spellings satisfy `image?: string | null`, so the mapping must pass each
 * through as it found it rather than normalising one into the other.
 */
function userDocWithoutImage(): WithId<UserDocument> {
  const doc = userDoc();
  delete doc.image;
  return doc;
}

describe("toUserRecord", () => {
  it("renames _id to id and leaves no _id behind", () => {
    const doc = userDoc();

    const record = toUserRecord(doc);

    expect(record.id).toBe(doc._id);
    // `toEqual` treats an `_id: undefined` as absent, so the own-key check is
    // what actually pins "the key is gone" rather than "the key is empty".
    expect(Object.prototype.hasOwnProperty.call(record, "_id")).toBe(false);
    expect(record).not.toHaveProperty("_id");
  });

  it("passes every other field through unchanged", () => {
    const doc = userDoc();
    const { _id, ...expected } = doc;

    // Deep equality against the whole document, minus the renamed key: userId,
    // email, name, image, role, lastLoginAt, createdAt and updatedAt are all
    // covered, and any added, dropped or re-derived field would fail here.
    expect(toUserRecord(doc)).toEqual({ ...expected, id: _id });
  });

  it("keeps the type discriminator, which UserRecord does not declare", () => {
    const record = toUserRecord(userDoc());

    // Not a tidy-up candidate: `hydrateDocument` keeps `type` on every other
    // store's read path (R32/R38), and this store's mapping has to match it.
    // The value is deliberately present on an object whose declared type has no
    // such field -- spreading an excess key compiles, so this is a choice, not
    // an accident to be cleaned away.
    expect(record).toHaveProperty("type", "user");
  });

  it("keeps a stored null image as null", () => {
    const record = toUserRecord(userDoc({ image: null }));

    expect(Object.prototype.hasOwnProperty.call(record, "image")).toBe(true);
    expect(record.image).toBeNull();
  });

  it("keeps an absent image absent, rather than inventing a null", () => {
    const record = toUserRecord(userDocWithoutImage());

    expect(Object.prototype.hasOwnProperty.call(record, "image")).toBe(false);
    expect(record.image).toBeUndefined();
  });

  it("returns a record shaped like UserRecord for every read path", () => {
    // The mapping is the sole producer of `UserRecord` in the store --
    // `upsertUser` (both branches), `getUser`, `getAllUsers` and
    // `updateUserRole` all funnel through it -- so its contract is fixed
    // here.
    const doc = userDoc();
    const record: UserRecord = toUserRecord(doc);

    expect(record.userId).toBe(doc.userId);
    expect(record.email).toBe(doc.email);
    expect(record.name).toBe(doc.name);
    expect(record.image).toBe(doc.image);
    expect(record.role).toBe(doc.role);
    expect(record.lastLoginAt).toBe(doc.lastLoginAt);
    expect(record.createdAt).toBe(doc.createdAt);
    expect(record.updatedAt).toBe(doc.updatedAt);
  });
});
