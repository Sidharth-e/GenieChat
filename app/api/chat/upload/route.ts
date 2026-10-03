import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { presignGet, putObject } from "@/lib/storage";
import { keyForUser } from "@/lib/storage/ref";
import { STORAGE_BUCKETS, STORAGE_TTL } from "@/constants/storage";
import { generateId } from "@/lib/utils";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";
import { getFileExtension, isSupportedDocumentFile } from "@/lib/document-file-support";
import { DOCUMENT_MAX_UPLOAD_DOCUMENT_SIZE } from "@/constants/config";
import { z } from "zod";

const ALLOWED_IMAGE_TYPES = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
];

const MAX_DOCUMENT_SIZE = DOCUMENT_MAX_UPLOAD_DOCUMENT_SIZE;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

const uploadMetadataSchema = z.object({
    threadId: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[a-zA-Z0-9_-]+$/)
        .optional(),
});

function sanitizeFileName(name: string): string {
    return (
        name
            .replace(/[\\/:*?"<>|\x00-\x1F]/g, "_")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 180) || "file"
    );
}

export async function POST(request: NextRequest) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();

        const rateLimit = await checkRateLimit(request, {
            namespace: "chat_upload",
            identifier: user.id,
            ...config.rateLimit.upload,
        });
        if (!rateLimit.allowed) {
            return api.tooManyRequests(
                `Too many upload requests. Retry after ${rateLimit.retryAfterSeconds}s`,
                rateLimit.retryAfterSeconds,
            );
        }

        const formData = await request.formData();
        const file = formData.get("file");
        const parsedMetadata = uploadMetadataSchema.safeParse({
            threadId: formData.get("threadId") ?? undefined,
        });

        if (!parsedMetadata.success) {
            return api.badRequest("Invalid threadId format");
        }

        if (!(file instanceof File)) return api.badRequest("File is required");

        const { threadId } = parsedMetadata.data;

        const isImage = ALLOWED_IMAGE_TYPES.includes((file.type || "").toLowerCase());
        const isDocument = isSupportedDocumentFile(file);

        if (!isImage && !isDocument) {
            return api.badRequest(
                `Unsupported file type: ${file.type || getFileExtension(file.name) || "unknown"}`,
            );
        }

        const maxSize = isImage ? MAX_IMAGE_SIZE : MAX_DOCUMENT_SIZE;
        if (file.size > maxSize) {
            const maxSizeMB = maxSize / (1024 * 1024);
            return api.badRequest(`File too large. Maximum size is ${maxSizeMB}MB`);
        }

        const fileId = generateId();
        const timestamp = Date.now();
        const bucket = isImage
            ? STORAGE_BUCKETS.chatImages
            : STORAGE_BUCKETS.chatDocuments;
        const folder = threadId || "pending";
        const normalizedFileName = file.name
            ? sanitizeFileName(file.name)
            : `pasted-image-${timestamp}.${file.type.split('/')[1] || 'png'}`;
        const fileName = normalizedFileName;
        // Keys this route writes are always user-scoped, which is what makes
        // ownership a single check (`isUserScopedKey`) at the proxy boundary.
        // That is a property of this constructor, not of every key already in
        // the buckets -- see `keyForUser` in lib/storage/ref.ts.
        const key = keyForUser(user.id, folder, `${timestamp}-${fileId}-${fileName}`);

        const buffer = Buffer.from(await file.arrayBuffer());

        logger.info(`[ChatUpload] Uploading ${isImage ? "image" : "document"}: ${fileName}`);
        const uploadResult = await putObject(bucket, key, buffer);

        if (uploadResult.status !== "OK") {
            logger.error({ err: uploadResult }, "[ChatUpload] Upload failed");
            return api.serverError("Failed to upload file");
        }

        logger.info(`[ChatUpload] Successfully uploaded: ${uploadResult.response}`);

        return api.created({
            id: fileId,
            fileName: fileName,
            // The ref is what the client sends back and what gets persisted.
            ref: uploadResult.response,
            // Signed for immediate preview only. The client holds it in the
            // draft store's localStorage and sends the whole attachment back on
            // the next submit -- the zod attachment schema strips this field on
            // arrival, so it never reaches MongoDB.
            //
            // Presigning runs *after* a successful putObject, so a throw at this
            // line would leave an unreferenced object behind. It cannot throw:
            // the ref just came back from `formatRef` with a non-empty key, so
            // `parseRef` succeeds; STORAGE_TTL.attachment is under the SigV4
            // ceiling; and this line is only reachable when `putObject` returned
            // OK, which means the internal client exists -- and the public
            // client shares its credentials, and its endpoint falls back to the
            // internal one, so it exists too.
            previewUrl: await presignGet(uploadResult.response, STORAGE_TTL.attachment),
            mimeType: file.type,
            fileSize: file.size,
            type: isImage ? "image" : "document",
        });
    } catch (error) {
        return handleError(error, "Upload file");
    }
}
