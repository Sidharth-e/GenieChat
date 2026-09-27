const SUPPORTED_DOCUMENT_MIME_TYPES = new Set([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
    "text/html",
    "application/xhtml+xml",
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/bmp",
    "image/tiff",
]);

const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
    ".pdf",
    ".docx",
    ".xlsx",
    ".pptx",
    ".txt",
    ".md",
    ".markdown",
    ".csv",
    ".json",
    ".html",
    ".htm",
    ".jpg",
    ".jpeg",
    ".png",
    ".bmp",
    ".tif",
    ".tiff",
]);

export const SUPPORTED_DOCUMENT_ACCEPT =
    ".pdf,.docx,.xlsx,.pptx,.txt,.md,.markdown,.csv,.json,.html,.htm,.jpg,.jpeg,.png,.bmp,.tif,.tiff";

export const SUPPORTED_DOCUMENT_FORMATS_LABEL =
    "PDF, Word, Excel, PowerPoint, HTML, TXT, MD, CSV, JSON, JPG/PNG/BMP/TIFF";

export function getFileExtension(fileName: string): string {
    const lastDotIndex = fileName.lastIndexOf(".");
    if (lastDotIndex <= 0 || lastDotIndex === fileName.length - 1) {
        return "";
    }
    return fileName.slice(lastDotIndex).toLowerCase();
}

export function isSupportedDocumentFile(file: { name: string; type?: string | null }): boolean {
    const mimeType = (file.type || "").toLowerCase().split(";")[0].trim();
    const extension = getFileExtension(file.name);

    if (mimeType && SUPPORTED_DOCUMENT_MIME_TYPES.has(mimeType)) {
        return true;
    }

    return SUPPORTED_DOCUMENT_EXTENSIONS.has(extension);
}
