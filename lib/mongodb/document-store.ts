import { Collection } from "mongodb";
import { getChatCitationsCollection, getDocumentCollection } from "./client";
import {
  ChatCitationDocument,
  ChatDocument,
  escapeRegex,
  hydrateDocument,
  WithMongoId,
} from "./common";
import {
  CHAT_CITATION_ATTRIBUTE,
  CHAT_DOCUMENT_ATTRIBUTE,
} from "@/constants/knowledge";

// The type discriminators are imported from the model layer rather than spelled
// out as string literals here. That module is pure constants and types with no
// imports of its own, so this creates no cycle.

/**
 * The `CHAT_DOCUMENT` documents in the `documents` collection -- what
 * `lib/knowledge/documents.ts` used to query, upsert and delete
 * through the Cosmos `documents` container directly.
 */
export class ChatDocumentStore {
  private documentsCollection: Collection<WithMongoId<ChatDocument>>;

  constructor() {
    this.documentsCollection = getDocumentCollection();
  }

  async findAllChatDocuments(chatThreadId: string): Promise<ChatDocument[]> {
    // `SELECT * ... WHERE r.type=@type AND r.chatThreadId = @threadId AND
    // r.isDeleted=@isDeleted` becomes the three same-named predicates. No
    // explicit sort: the Cosmos query ordered by nothing either.
    const docs = await this.documentsCollection
      .find({
        type: CHAT_DOCUMENT_ATTRIBUTE,
        chatThreadId,
        isDeleted: false,
      })
      .toArray();

    return docs.map((doc) => hydrateDocument(doc));
  }

  async findChatDocumentByName(
    chatThreadId: string,
    documentName: string,
  ): Promise<ChatDocument | null> {
    // Cosmos's `CONTAINS(r.name, @documentName, true)` was a case-insensitive
    // substring test, which `$options: "i"` reproduces. `escapeRegex` keeps the
    // name literal: it comes from an uploaded filename, so a name like
    // "report (final).pdf" would otherwise be read as a pattern -- matching the
    // wrong documents, or throwing on an unbalanced bracket.
    const doc = await this.documentsCollection.findOne({
      type: CHAT_DOCUMENT_ATTRIBUTE,
      chatThreadId,
      isDeleted: false,
      name: { $regex: escapeRegex(documentName), $options: "i" },
    });

    return doc ? hydrateDocument(doc) : null;
  }

  async findChatDocumentById(
    chatThreadId: string,
    id: string,
  ): Promise<ChatDocument | null> {
    // `_id` is what every read and write in this layer addresses a document by,
    // holding the same value as the app-level `id` (`upsertDocument` keeps them
    // paired). The Cosmos query this ports filtered on `r.id`, which is that
    // same value.
    //
    // No `isDeleted` predicate here, deliberately: the Cosmos query had none
    // either, so a soft-deleted document is still found by id -- which is what
    // `DeleteChatDocument` relies on to delete one at all. The other two reads
    // above do filter it out, matching their own queries.
    const doc = await this.documentsCollection.findOne({
      _id: id,
      type: CHAT_DOCUMENT_ATTRIBUTE,
      chatThreadId,
    });

    return doc ? hydrateDocument(doc) : null;
  }

  async deleteDocument(
    chatThreadId: string,
    documentId: string,
    userId: string,
  ): Promise<void> {
    // `userId` is the ownership check Cosmos enforced through the partition key
    // it addressed the item by (`item(documentId, userId)`), and it is what
    // keeps this delete from reaching another tenant's document. The thread
    // conjunct costs nothing and matches this store's other three reads, which
    // all address a document through its thread.
    //
    // Returns `void`, so there is no return value a miss could falsify and no
    // `deletedCount` test to make: the caller reads the document first, so a
    // miss means it vanished between that read and this write -- the same
    // narrow race Cosmos would have thrown on.
    await this.documentsCollection.deleteOne({
      _id: documentId,
      userId,
      chatThreadId,
    });
  }

  async upsertDocument(chatDocument: ChatDocument): Promise<ChatDocument> {
    // `_id` and `id` hold the same generated value, as in every other write in
    // this layer. The variable is annotated rather than the literal passed
    // straight to the driver because it has to survive to the return below --
    // and because `hydrateDocument` needs an argument whose type actually
    // declares `_id`, which an anonymous literal's inferred type does not.
    const saved: WithMongoId<ChatDocument> = {
      ...chatDocument,
      _id: chatDocument.id,
    };

    // Cosmos's `items.upsert(modelToSave)` becomes an upserting `replaceOne`.
    // `upsert: true` is required rather than optional: the first save of an id
    // genuinely inserts. The replacement carries no `_id`, so Mongo copies the
    // filter's equality field onto the inserted document and `_id` is that same
    // generated `id`. No `matchedCount` guard: an upsert always matches or
    // creates, so there is no prior read for it to lose a race with.
    const { _id, ...rest } = saved;
    await this.documentsCollection.replaceOne({ _id }, rest, {
      upsert: true,
    });

    // What was written is the filter's `_id` plus the replacement's fields, so
    // this needs no read-back. It still goes through `hydrateDocument`, because
    // `ChatDocument` declares `id` and no `_id`: returning the driver's
    // document shape untouched would carry `_id` and no `id` while still typing
    // as `id: string`.
    return hydrateDocument(saved);
  }
}

/**
 * The `CHAT_CITATION` documents in the mixed-type `history` collection, which
 * also holds messages and ai-usage documents. Hence `getChatCitationsCollection`
 * rather than the messages' accessor, whose `MessageDocument` type rejects both
 * of the filters below.
 */
export class ChatCitationStore {
  private citationsCollection: Collection<WithMongoId<ChatCitationDocument>>;

  constructor() {
    this.citationsCollection = getChatCitationsCollection();
  }

  async createCitation(
    citation: ChatCitationDocument,
  ): Promise<ChatCitationDocument> {
    // Annotated rather than an anonymous literal: `hydrateDocument` needs an
    // argument whose type declares `_id`, and inferring the type parameter from
    // an anonymous literal would carry `_id` into it and resolve to `never`.
    // `_id` and `id` hold the same generated value.
    const created: WithMongoId<ChatCitationDocument> = {
      ...citation,
      _id: citation.id,
    };

    await this.citationsCollection.insertOne(created);

    // Hydrated so consumers get `id` and never the driver's `_id` -- the same
    // reason as `upsertDocument` above.
    return hydrateDocument(created);
  }

  async findCitationById(
    id: string,
    userId: string,
  ): Promise<ChatCitationDocument | null> {
    // `SELECT * FROM root r WHERE r.type=@type AND r.id=@id AND r.userId=@userId`
    // -- the `userId` predicate is the ownership check. The `type` filter stays
    // even though this accessor is citation-typed, because the collection is
    // shared with messages.
    const doc = await this.citationsCollection.findOne({
      _id: id,
      type: CHAT_CITATION_ATTRIBUTE,
      userId,
    });

    if (!doc) return null;
    return hydrateDocument(doc);
  }
}
