import { logger } from "@/lib/logger";
import { Message, DocumentReference, ImageReference } from "@/lib/types";
import { budgetDocumentText, convertDocument } from "@/lib/docling";
import { DOCUMENT_PROMPT_TOKEN_BUDGET } from "@/constants/config";
import {
  getObjectAsBase64,
  getObjectAsBuffer,
  presignGet,
  putObject,
} from "@/lib/storage";
import { isUserScopedKey, parseRef, type StorageRef } from "@/lib/storage/ref";
import { STORAGE_TTL, type StorageBucket } from "@/constants/storage";

interface UploadedDocumentInput {
  id: string;
  fileName: string;
  ref: StorageRef;
  mimeType?: string;
}

interface UploadedImageInput extends UploadedDocumentInput {
  mimeType: string;
}

/**
 * Validates a stored reference and confirms the user owns it.
 *
 * The bucket allowlists and hostname check are unnecessary: the ref names a
 * bucket from a closed set (`parseRef` rejects anything else), and ownership is
 * a prefix test (`isUserScopedKey`): keys written under this convention put the
 * user id first, so a ref whose first segment is not the caller's id is refused
 * rather than read. That test runs against refs arriving in the **request body**
 * (`doc.ref` and `img.ref` below), not only against refs this server minted —
 * which is the whole reason it exists.
 */
function parseAndValidateRef(
  ref: string,
  userId: string,
  logPrefix: string,
): { bucket: StorageBucket; key: string } | null {
  const parsed = parseRef(ref);
  if (!parsed) {
    logger.warn(`${logPrefix} Invalid storage reference`);
    return null;
  }

  if (!isUserScopedKey(parsed.key, userId)) {
    logger.warn(`${logPrefix} Storage key is not user-scoped`, {
      userId,
      bucket: parsed.bucket,
    });
    return null;
  }

  return parsed;
}

function normalizeMessageContent(rawContent: unknown): string {
  if (typeof rawContent === "string") {
    return rawContent;
  }

  if (Array.isArray(rawContent)) {
    const textParts = rawContent
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (!part || typeof part !== "object") {
          return "";
        }

        const partObj = part as Record<string, unknown>;
        if (typeof partObj.text === "string") {
          return partObj.text;
        }

        return "";
      })
      .filter(Boolean);

    return textParts.join("\n").trim();
  }

  if (rawContent && typeof rawContent === "object") {
    const contentObj = rawContent as Record<string, unknown>;
    if (typeof contentObj.text === "string") {
      return contentObj.text;
    }
  }

  return "";
}

// Helper to fetch text content from a stored reference
export async function fetchTextFromRef(
  ref: string,
  userId: string,
  logPrefix: string = "[API]",
): Promise<string> {
  try {
    if (!parseAndValidateRef(ref, userId, logPrefix)) {
      return "(Invalid document reference)";
    }

    const result = await getObjectAsBuffer(ref);

    if (result.status === "OK") {
      return result.response.toString("utf-8");
    }
    return "(Failed to fetch document text)";
  } catch (e) {
    logger.error("Error fetching text from storage:", e);
    return "(Error fetching document text)";
  }
}

// Helper to append extracted text to messages for the LLM context
export async function hydrateMessages(
  messages: Message[],
  userId: string,
  logPrefix: string = "[API]",
): Promise<Message[]> {
  return Promise.all(
    messages.map(async (msg) => {
      const normalizedContent = normalizeMessageContent(
        (msg as unknown as { content?: unknown }).content,
      );
      const scopedUserId = userId || msg.userId;

      if (msg.role === "user") {
        let contentWithContext = normalizedContent;
        let hasContext = false;

        if (msg.documents && msg.documents.some((d) => d.extractedTextRef)) {
          contentWithContext += "\n\n--- Attached Documents ---\n";
          for (const doc of msg.documents) {
            if (doc.extractedTextRef) {
              const extractedText = await fetchTextFromRef(
                doc.extractedTextRef,
                scopedUserId,
                logPrefix,
              );
              const budgeted = budgetDocumentText(
                extractedText,
                DOCUMENT_PROMPT_TOKEN_BUDGET,
                doc.fileName,
              );
              contentWithContext += `\n[File: ${doc.fileName}]\n`;

              if (doc.ref) {
                const blobRef = parseAndValidateRef(
                  doc.ref,
                  scopedUserId,
                  logPrefix,
                );
                if (blobRef) {
                  const canonicalDocUrl = await presignGet(
                    doc.ref,
                    STORAGE_TTL.attachment,
                  );
                  contentWithContext += `Source URL for this file: ${canonicalDocUrl}\n`;
                }
              }

              contentWithContext += `${budgeted.text}\n`;
            }
          }
          hasContext = true;
        }

        if (msg.images && msg.images.length > 0) {
          contentWithContext += "\n\n--- Attached Images ---\n";
          for (const img of msg.images) {
            if (img.ref) {
              const blobRef = parseAndValidateRef(
                img.ref,
                scopedUserId,
                logPrefix,
              );
              if (!blobRef) {
                logger.warn(
                  `${logPrefix} Skipping unauthorized image in hydrated context`,
                  { fileName: img.fileName },
                );
                continue;
              }
              const canonicalImageUrl = await presignGet(
                img.ref,
                STORAGE_TTL.attachment,
              );
              contentWithContext += `\n[Image: ${img.fileName || "image"}]\nSource URL for this image: ${canonicalImageUrl}\n`;
            }
          }
          hasContext = true;
        }

        if (hasContext) {
          logger.info(
            `${logPrefix} Hydrated content:`,
            contentWithContext.slice(0, 200) + "...",
          );
          return { ...msg, content: contentWithContext };
        }
      }

      if (msg.role !== "user" && !normalizedContent && msg.toolCalls?.length) {
        const parts: string[] = [];
        for (const tc of msg.toolCalls) {
          if (tc.name === "generate_canvas" && tc.arguments?.description) {
            const desc = String(tc.arguments.description).slice(0, 100);
            parts.push(
              `[Canvas component generated: "${desc}". To modify it, use generate_canvas — the existing code is provided automatically.]`,
            );
          } else if (tc.name) {
            parts.push(`[Tool executed: ${tc.name}]`);
          }
        }
        return {
          ...msg,
          content: parts.length > 0 ? parts.join("\n") : "[Tool calls executed]",
        };
      }

      return { ...msg, content: normalizedContent };
    }),
  );
}

export async function processDocuments(
  documents: UploadedDocumentInput[],
  userId: string,
  logPrefix: string = "[API]",
): Promise<DocumentReference[]> {
  const processedDocuments: DocumentReference[] = [];

  if (documents && documents.length > 0) {
    logger.info(`${logPrefix} Processing`, documents.length, "document(s)");
    for (const doc of documents) {
      try {
        const parsed = parseAndValidateRef(doc.ref, userId, logPrefix);
        if (!parsed) {
          logger.warn(`${logPrefix} Skipping unauthorized document attachment`, {
            fileName: doc.fileName,
          });
          continue;
        }

        const blobResult = await getObjectAsBuffer(doc.ref);

        let extractedText = "";
        let extractedTextRef: string | undefined;

        if (blobResult.status === "OK") {
          const buffer = blobResult.response;

          // Plain-text bypass and binary parsing both live in the docling
          // client, so this path does not need to know the difference.
          const processResult = await convertDocument(
            buffer,
            doc.fileName,
            doc.mimeType ?? "",
          );
          let processSuccess = false;

          if (processResult.status === "OK") {
            extractedText = processResult.response.documents.join("\n\n");
            if (processResult.partial) {
              // The service reported `partial_success`. Claim no more than that:
              // a `document_timeout` abort reports the same status, so "some
              // pages failed to convert" is not a reading this flag supports, and
              // a content-bearing `partial_success` has never been observed.
              extractedText +=
                "\n\n[Note: the document service reported only a partial conversion of this file, so this extract may be incomplete.]";
            }
            processSuccess = true;
          } else {
            logger.error("Failed to process document:", processResult);
            // A failure the user is never told about is the silent failure this
            // design rejects everywhere else: the attachment chip still renders,
            // so the turn looks like it carried a document the model never saw.
            // Mirroring the partial notice above keeps that visible — the file
            // is still stored, only its text extraction failed.
            extractedText =
              "\n\n[Note: the document service could not convert this file, so its contents are not part of this turn. The file itself is still attached and stored.]";
            processSuccess = true;
          }

          if (processSuccess) {
            // Save extracted text to object storage instead of DB
            const textKey = `${parsed.key}.extracted.txt`;
            const uploadResult = await putObject(
              parsed.bucket,
              textKey,
              Buffer.from(extractedText, "utf-8"),
            );

            if (uploadResult.status === "OK") {
              extractedTextRef = uploadResult.response;
              logger.info(
                `${logPrefix} Saved extracted text to storage:`,
                textKey,
              );
            } else {
              logger.error(
                "Failed to save extracted text to storage:",
                uploadResult,
              );
            }
          }
        } else {
          logger.error("Failed to fetch document:", blobResult);
        }

        logger.info(
          `${logPrefix} Processed document:`,
          doc.fileName,
          "extracted text length:",
          extractedText.length,
        );

        processedDocuments.push({
          id: doc.id,
          fileName: doc.fileName,
          ref: doc.ref,
          extractedTextRef,
        });
      } catch (e) {
        logger.error(`Error processing document ${doc.fileName}:`, e);
      }
    }
  }
  return processedDocuments;
}

export async function processImages(
  images: UploadedImageInput[],
  userId: string,
  logPrefix: string = "[API]",
): Promise<{
  processedImages: ImageReference[];
  imagesForAI: { base64Data: string; mimeType: string }[];
}> {
  const processedImages: ImageReference[] = [];
  const imagesForAI: { base64Data: string; mimeType: string }[] = [];

  if (images && images.length > 0) {
    logger.info(`${logPrefix} Processing`, images.length, "image(s)");
    for (const img of images) {
      try {
        if (!parseAndValidateRef(img.ref, userId, logPrefix)) {
          logger.warn(`${logPrefix} Skipping unauthorized image attachment`, {
            fileName: img.fileName,
          });
          continue;
        }

        logger.info(
          `${logPrefix} Processing image:`,
          img.fileName,
          "from ref:",
          img.ref,
        );

        processedImages.push({
          id: img.id,
          fileName: img.fileName,
          ref: img.ref,
          mimeType: img.mimeType,
        });

        // Fetch base64 data for AI analysis
        const base64Result = await getObjectAsBase64(img.ref);
        if (base64Result.status === "OK") {
          // Create data URL format for AI
          const dataUrl = `data:${img.mimeType};base64,${base64Result.response}`;
          imagesForAI.push({
            base64Data: dataUrl,
            mimeType: img.mimeType,
          });
        } else {
          logger.error("Failed to fetch image as base64:", base64Result);
        }
      } catch (e) {
        logger.error(`Error processing image ${img.fileName}:`, e);
      }
    }
  }
  return { processedImages, imagesForAI };
}

export async function getHistoricalImages(
  existingMessages: Message[],
  userId: string,
  logPrefix: string = "[API]",
): Promise<{ base64Data: string; mimeType: string }[]> {
  const imagesForAI: { base64Data: string; mimeType: string }[] = [];

  for (const msg of existingMessages) {
    if (msg.images && msg.images.length > 0) {
      for (const img of msg.images) {
        try {
          if (!parseAndValidateRef(img.ref, userId, logPrefix)) {
            logger.warn(`${logPrefix} Skipping unauthorized historical image`, {
              fileName: img.fileName,
            });
            continue;
          }

          const base64Result = await getObjectAsBase64(img.ref);
          if (base64Result.status === "OK") {
            imagesForAI.push({
              base64Data: `data:${img.mimeType};base64,${base64Result.response}`,
              mimeType: img.mimeType,
            });
            logger.info(
              `${logPrefix} Added historical image for follow-up context:`,
              img.fileName,
            );
          }
        } catch (e) {
          logger.error(`Error fetching historical image ${img.fileName}:`, e);
        }
      }
    }
  }
  return imagesForAI;
}
