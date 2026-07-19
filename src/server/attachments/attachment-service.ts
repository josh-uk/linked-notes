import { z } from "zod";

import type {
  AttachmentItem,
  AttachmentsPage,
  NoteDetail,
} from "@/features/notes/types";
import { prisma } from "@/server/db";
import { NoteDomainError } from "@/server/notes/note-errors";
import { getNote } from "@/server/notes/note-service";

import {
  checksumStoredFile,
  createStoredFile,
  deleteStagingFiles,
  deleteStoredFiles,
  isSafePreviewMimeType,
  listStaleStagingFiles,
  listStoredFileNames,
  openStoredFile,
  sanitizeDisplayFilename,
  storedFileState,
} from "./attachment-storage";

const attachmentIdSchema = z.string().uuid();
const noteIdSchema = z.string().uuid();
const expectedVersionSchema = z.coerce.number().int().positive();

export const uploadAttachmentInputSchema = z
  .object({
    filename: z.string().min(1).max(1_000),
    expectedVersion: expectedVersionSchema,
    contentLength: z.number().int().positive().nullable(),
    declaredMimeType: z.string().max(255).nullable(),
  })
  .strict();

export const listAttachmentsInputSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const deleteAttachmentInputSchema = z
  .object({ expectedVersion: expectedVersionSchema })
  .strict();

export const reconcileAttachmentsInputSchema = z
  .object({ repairOrphans: z.boolean().default(false) })
  .strict();

export async function uploadAttachment(
  noteId: string,
  value: unknown,
  source: AsyncIterable<Uint8Array>,
): Promise<{ attachment: AttachmentItem; note: NoteDetail }> {
  noteIdSchema.parse(noteId);
  const input = uploadAttachmentInputSchema.parse(value);
  const before = await prisma.note.findUnique({
    where: { id: noteId },
    select: { optimisticVersion: true, trashedAt: true },
  });
  if (!before) throw notFound("NOTE_NOT_FOUND", "Note not found");
  if (before.trashedAt) {
    throw new NoteDomainError(
      "ATTACHMENT_NOTE_TRASHED",
      "Restore the note before adding attachments",
      409,
    );
  }
  if (before.optimisticVersion !== input.expectedVersion) {
    throw attachmentConflict();
  }

  const stored = await createStoredFile(source, {
    contentLength: input.contentLength,
    declaredMimeType: input.declaredMimeType,
  });
  try {
    const attachment = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.note.updateMany({
        where: {
          id: noteId,
          optimisticVersion: input.expectedVersion,
          trashedAt: null,
        },
        data: { optimisticVersion: { increment: 1 } },
      });
      if (updated.count !== 1) throw attachmentConflict();
      return transaction.attachment.create({
        data: {
          noteId,
          originalName: sanitizeDisplayFilename(input.filename),
          storageName: stored.storageName,
          mimeType: stored.mimeType,
          byteSize: BigInt(stored.byteSize),
          checksumSha256: stored.checksumSha256,
          width: stored.width,
          height: stored.height,
        },
      });
    });
    return {
      attachment: serializeAttachment(attachment, {
        available: true,
        byteSize: stored.byteSize,
      }),
      note: await getNote(noteId),
    };
  } catch (error) {
    await deleteStoredFiles([stored.storageName]);
    throw error;
  }
}

export async function listNoteAttachments(
  noteId: string,
  value: unknown,
): Promise<AttachmentsPage> {
  noteIdSchema.parse(noteId);
  const input = listAttachmentsInputSchema.parse(value);
  if (
    !(await prisma.note.findUnique({
      where: { id: noteId },
      select: { id: true },
    }))
  ) {
    throw notFound("NOTE_NOT_FOUND", "Note not found");
  }
  const attachments = await prisma.attachment.findMany({
    where: { noteId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const hasMore = attachments.length > input.limit;
  const visible = hasMore ? attachments.slice(0, input.limit) : attachments;
  const items = await Promise.all(
    visible.map(async (attachment) =>
      serializeAttachment(
        attachment,
        await storedFileState(
          attachment.storageName,
          Number(attachment.byteSize),
        ),
      ),
    ),
  );
  return {
    items,
    nextCursor: hasMore ? (visible.at(-1)?.id ?? null) : null,
  };
}

export async function deleteAttachment(
  attachmentId: string,
  value: unknown,
): Promise<{ id: string; deleted: true; note: NoteDetail }> {
  attachmentIdSchema.parse(attachmentId);
  const input = deleteAttachmentInputSchema.parse(value);
  const deleted = await prisma.$transaction(async (transaction) => {
    const attachment = await transaction.attachment.findUnique({
      where: { id: attachmentId },
    });
    if (!attachment) {
      throw notFound("ATTACHMENT_NOT_FOUND", "Attachment not found");
    }
    const updated = await transaction.note.updateMany({
      where: {
        id: attachment.noteId,
        optimisticVersion: input.expectedVersion,
      },
      data: { optimisticVersion: { increment: 1 } },
    });
    if (updated.count !== 1) throw attachmentConflict();
    await transaction.attachment.delete({ where: { id: attachmentId } });
    return attachment;
  });

  await deleteStoredFiles([deleted.storageName]);
  return {
    id: attachmentId,
    deleted: true,
    note: await getNote(deleted.noteId),
  };
}

export async function getAttachmentDownload(attachmentId: string) {
  attachmentIdSchema.parse(attachmentId);
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
  });
  if (!attachment) {
    throw notFound("ATTACHMENT_NOT_FOUND", "Attachment not found");
  }
  return {
    attachment,
    stream: await openStoredFile(
      attachment.storageName,
      Number(attachment.byteSize),
    ),
  };
}

export async function reconcileAttachments(value: unknown) {
  const input = reconcileAttachmentsInputSchema.parse(value);
  const metadata = await prisma.attachment.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      storageName: true,
      byteSize: true,
      checksumSha256: true,
    },
  });
  const storedNames = await listStoredFileNames();
  const referencedNames = new Set(
    metadata.map(({ storageName }) => storageName),
  );
  const orphanedStorageNames = storedNames.filter(
    (storageName) => !referencedNames.has(storageName),
  );
  const missingAttachmentIds: string[] = [];
  const corruptAttachmentIds: string[] = [];

  for (const attachment of metadata) {
    const state = await storedFileState(
      attachment.storageName,
      Number(attachment.byteSize),
    );
    if (!state.available) {
      if (state.reason === "missing") missingAttachmentIds.push(attachment.id);
      else corruptAttachmentIds.push(attachment.id);
      continue;
    }
    if (
      (await checksumStoredFile(attachment.storageName)) !==
      attachment.checksumSha256
    ) {
      corruptAttachmentIds.push(attachment.id);
    }
  }

  const staleStagingNames = await listStaleStagingFiles(
    new Date(Date.now() - 24 * 60 * 60 * 1_000),
  );
  const repair = input.repairOrphans
    ? {
        orphanedBytes: await deleteStoredFiles(orphanedStorageNames),
        staleStagingFiles: await deleteStagingFiles(staleStagingNames),
      }
    : null;

  const summary = {
    metadataCount: metadata.length,
    storedFileCount: storedNames.length,
    missingCount: missingAttachmentIds.length,
    corruptCount: corruptAttachmentIds.length,
    orphanCount: orphanedStorageNames.length,
    staleStagingCount: staleStagingNames.length,
    repaired: input.repairOrphans,
  };
  const hasIntegrityProblem =
    summary.missingCount > 0 ||
    summary.corruptCount > 0 ||
    summary.orphanCount > 0 ||
    summary.staleStagingCount > 0;
  if (hasIntegrityProblem) console.warn("attachment_reconciliation", summary);
  else console.info("attachment_reconciliation", summary);

  return {
    metadataCount: metadata.length,
    storedFileCount: storedNames.length,
    missingAttachmentIds,
    corruptAttachmentIds,
    orphanedStorageNames,
    staleStagingNames,
    repair,
  };
}

function serializeAttachment(
  attachment: {
    id: string;
    noteId: string;
    originalName: string;
    mimeType: string;
    byteSize: bigint;
    checksumSha256: string;
    width: number | null;
    height: number | null;
    createdAt: Date;
  },
  state:
    | { available: true; byteSize: number }
    | { available: false; reason: "missing" | "size-mismatch" },
): AttachmentItem {
  const previewable = isSafePreviewMimeType(attachment.mimeType);
  return {
    id: attachment.id,
    noteId: attachment.noteId,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    byteSize: Number(attachment.byteSize),
    checksumSha256: attachment.checksumSha256,
    width: attachment.width,
    height: attachment.height,
    createdAt: attachment.createdAt.toISOString(),
    available: state.available,
    unavailableReason: state.available ? null : state.reason,
    downloadUrl: `/api/attachments/${attachment.id}`,
    previewUrl:
      previewable && state.available
        ? `/api/attachments/${attachment.id}?disposition=inline`
        : null,
  };
}

function attachmentConflict() {
  return new NoteDomainError(
    "ATTACHMENT_CONFLICT",
    "The note changed before the attachment operation completed",
    409,
  );
}

function notFound(code: string, message: string) {
  return new NoteDomainError(code, message, 404);
}
