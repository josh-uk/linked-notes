import { createHash } from "node:crypto";

import { z } from "zod";

import { readServerEnvironment } from "@/lib/env";
import { prisma } from "@/server/db";
import {
  isSafePreviewMimeType,
  openStoredFile,
  sanitizeDisplayFilename,
  storedFileState,
} from "@/server/attachments/attachment-storage";
import { NoteDomainError } from "@/server/notes/note-errors";
import { listBacklinksPage } from "@/server/notes/note-links";
import { getNote } from "@/server/notes/note-service";

import { renderNoteMarkdown } from "./markdown";
import { type PdfExportAttachment, renderNotePdf } from "./pdf-renderer";

export const noteExportInputSchema = z
  .object({
    format: z.enum(["markdown", "pdf"]),
    backlinks: z
      .union([
        z.boolean(),
        z.enum(["true", "false"]).transform((value) => value === "true"),
      ])
      .default(false),
  })
  .strict();

export async function exportNote(noteId: string, value: unknown) {
  z.string().uuid().parse(noteId);
  const input = noteExportInputSchema.parse(value);
  const note = await getNote(noteId);
  const attachments = await prisma.attachment.findMany({
    where: { noteId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  if (input.format === "markdown") {
    return {
      body: Buffer.from(
        renderNoteMarkdown({
          note: {
            id: note.id,
            title: note.title,
            content: note.content,
            createdAt: new Date(note.createdAt),
            updatedAt: new Date(note.updatedAt),
          },
          mentionTargets: note.mentionTargets,
          attachments: attachments.map((attachment) => ({
            originalName: attachment.originalName,
            mimeType: attachment.mimeType,
            byteSize: Number(attachment.byteSize),
            checksumSha256: attachment.checksumSha256,
          })),
        }),
      ),
      mimeType: "text/markdown; charset=utf-8",
      filename: exportFilename(note.title, "md"),
    };
  }

  const pdfAttachments = await preparePdfAttachments(attachments);
  const body = await renderNotePdf({
    note: {
      id: note.id,
      title: note.title,
      content: note.content,
      createdAt: new Date(note.createdAt),
      updatedAt: new Date(note.updatedAt),
      folderName: note.folder?.name ?? null,
      tags: note.tags,
    },
    mentionTargets: note.mentionTargets,
    attachments: pdfAttachments,
    backlinks: input.backlinks
      ? await listBacklinksPage(note.id, { limit: 100 })
      : null,
  });
  return {
    body,
    mimeType: "application/pdf",
    filename: exportFilename(note.title, "pdf"),
  };
}

async function preparePdfAttachments(
  attachments: Array<{
    originalName: string;
    storageName: string;
    mimeType: string;
    byteSize: bigint;
    checksumSha256: string;
    width: number | null;
    height: number | null;
  }>,
): Promise<PdfExportAttachment[]> {
  let remainingImageBytes = readServerEnvironment().MAX_PDF_IMAGE_BYTES;
  const output: PdfExportAttachment[] = [];
  for (const attachment of attachments) {
    const byteSize = Number(attachment.byteSize);
    const state = await storedFileState(attachment.storageName, byteSize);
    let available = state.available;
    let embeddedDataUrl: string | null = null;
    if (
      available &&
      isSafePreviewMimeType(attachment.mimeType) &&
      byteSize <= remainingImageBytes
    ) {
      const bytes = await collectStoredFile(attachment.storageName, byteSize);
      const checksum = createHash("sha256").update(bytes).digest("hex");
      if (checksum !== attachment.checksumSha256) available = false;
      else {
        embeddedDataUrl = `data:${attachment.mimeType};base64,${bytes.toString("base64")}`;
        remainingImageBytes -= byteSize;
      }
    }
    output.push({
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      byteSize,
      checksumSha256: attachment.checksumSha256,
      width: attachment.width,
      height: attachment.height,
      available,
      embeddedDataUrl,
    });
  }
  return output;
}

async function collectStoredFile(storageName: string, expectedSize: number) {
  const chunks: Buffer[] = [];
  let byteSize = 0;
  for await (const value of await openStoredFile(storageName, expectedSize)) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    byteSize += chunk.byteLength;
    if (byteSize > expectedSize) {
      throw new NoteDomainError(
        "ATTACHMENT_SIZE_MISMATCH",
        "An attachment changed while preparing the PDF",
        409,
      );
    }
    chunks.push(chunk);
  }
  if (byteSize !== expectedSize) {
    throw new NoteDomainError(
      "ATTACHMENT_SIZE_MISMATCH",
      "An attachment changed while preparing the PDF",
      409,
    );
  }
  return Buffer.concat(chunks, byteSize);
}

function exportFilename(title: string, extension: string) {
  const base = sanitizeDisplayFilename(title || "Untitled Note")
    .replaceAll(/\.[^.]{1,10}$/g, "")
    .slice(0, 180);
  return `${base || "Untitled Note"}.${extension}`;
}
