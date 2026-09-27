# docling-serve, plus LibreOffice.
#
# Upstream's image installs tesseract and leptonica but no LibreOffice. This
# layer adds it, and the two things it is worth knowing are both counter to the
# obvious guess, so they are recorded here rather than re-derived:
#
#   1. It does NOT add the legacy Office formats. Docling 2.93.0 has no
#      `InputFormat` for DOC/XLS/PPT (97-2004) or RTF at all — `FormatToExtensions`
#      lists only the OOXML extensions (docx/dotx/docm/dotm, xlsx/xlsm,
#      pptx/potx/...). A `.doc` is rejected as `"File format not allowed"` by
#      `DocumentConverter._process_document` before any backend runs, and the
#      rejection is IDENTICAL with and without this layer. Verified by converting
#      the same real MS Word 97 `.doc` against this image and against the
#      upstream base: both returned HTTP 200 `status: "skipped"` with
#      `errors:[{"component_type":"user_input","error_message":"File format not
#      allowed: probe.doc"}]`, so the layer changes nothing here.
#      So this image does not make `.doc`, `.xls` and `.ppt` work, and the
#      format list in `lib/document-file-support.ts` no longer advertises them.
#
#   2. What it does add is DrawingML/VML rendering inside DOCX. That is the ONLY
#      LibreOffice call site in the whole docling package
#      (`docling/backend/docx/drawingml/utils.py`, reached from
#      `MsWordDocumentBackend`), where shapes, charts, embedded objects and
#      EMF/WMF images are rendered by round-tripping a synthetic DOCX through
#      `soffice --convert-to pdf`. Without it the backend logs "Found DrawingML
#      elements in document, but no DOCX to PDF converters" and drops them.
#
# The packages are named individually because CentOS Stream 9 ships no
# `libreoffice` meta-package: `dnf install -y libreoffice` fails on this base
# with "No match for argument: libreoffice". The suite is split here, and
# `libreoffice-core` is what provides `/usr/bin/soffice`.
#
# The privilege dance mirrors upstream's own Containerfile: root only for the
# package install, then back to the unprivileged user the base image ships.
FROM quay.io/docling-project/docling-serve-cpu:v1.18.0

USER 0
RUN dnf install -y \
        libreoffice-core \
        libreoffice-writer \
        libreoffice-calc \
        libreoffice-impress \
    && dnf clean all \
    && rm -rf /var/cache/dnf

USER 1001

# Inherited from the base image: CMD ["docling-serve", "run"], EXPOSE 5001.
