import { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  EDITOR_DOCUMENT_SCHEMA_VERSION,
  EMPTY_EDITOR_DOCUMENT,
} from "@/features/notes/document-schema";
import type {
  BulkNoteAction,
  EditorDocument,
  MentionTarget,
  NoteDetail,
  NoteLifecycleAction,
  NoteSort,
  NoteSummary,
  NotesPage,
  NotesView,
  SortDirection,
} from "@/features/notes/types";
import { prisma } from "@/server/db";
import { deleteStoredFiles } from "@/server/attachments/attachment-storage";

import { deriveEditorDocument } from "./derive-document";
import { NoteDomainError } from "./note-errors";
import { reconcileNoteLinks, resolveMentionTargets } from "./note-links";
import {
  applyConfiguredTrashRetention,
  assertFolderExists,
  assertTagsExist,
} from "./organization-service";

const noteIdSchema = z.string().uuid();
const cursorSchema = z.string().uuid();
const uniqueTagIdsSchema = z
  .array(z.string().uuid())
  .max(30)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Tag IDs must be unique",
  });
const commaSeparatedIds = z
  .string()
  .max(1_850)
  .transform((value) => value.split(",").filter(Boolean))
  .pipe(uniqueTagIdsSchema);

export const createNoteInputSchema = z
  .object({
    title: z.string().trim().max(500).optional(),
    folderId: z.string().uuid().nullable().optional(),
    tagIds: uniqueTagIdsSchema.optional(),
  })
  .strict();

export const updateNoteInputSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    title: z.string().max(500).optional(),
    content: z.unknown().optional(),
  })
  .strict()
  .refine((input) => input.title !== undefined || input.content !== undefined, {
    message: "At least one note field must be supplied",
  });

export const updateNoteOrganizationInputSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    folderId: z.string().uuid().nullable().optional(),
    tagIds: uniqueTagIdsSchema.optional(),
  })
  .strict()
  .refine(
    (input) => input.folderId !== undefined || input.tagIds !== undefined,
    { message: "A folder or tag change is required" },
  );

export const lifecycleInputSchema = z
  .object({
    action: z.enum([
      "pin",
      "unpin",
      "archive",
      "unarchive",
      "trash",
      "restore",
    ]),
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export const permanentDeleteInputSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();

export const bulkNoteInputSchema = z
  .object({
    notes: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            expectedVersion: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine(
        (notes) => new Set(notes.map(({ id }) => id)).size === notes.length,
        {
          message: "Bulk note IDs must be unique",
        },
      ),
    action: z.enum(["pin", "archive", "trash", "restore", "move", "tag"]),
    folderId: z.string().uuid().nullable().optional(),
    tagIds: uniqueTagIdsSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.action === "move" && input.folderId === undefined) {
      context.addIssue({
        code: "custom",
        message: "Bulk move requires a folder",
      });
    }
    if (input.action === "tag" && !input.tagIds?.length) {
      context.addIssue({
        code: "custom",
        message: "Bulk tag requires at least one tag",
      });
    }
  });

export const listNotesInputSchema = z.object({
  view: z.enum(["all", "pinned", "archive", "trash"]).default("all"),
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  folderId: z.string().uuid().optional(),
  tagIds: commaSeparatedIds.optional(),
  attachments: z.enum(["any", "with", "without"]).default("any"),
  sort: z.enum(["updated", "created", "title"]).default("updated"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});

type ListNotesInput = {
  view: NotesView;
  cursor?: string;
  limit: number;
  folderId?: string;
  tagIds?: string[];
  attachments?: "any" | "with" | "without";
  sort?: Exclude<NoteSort, "relevance">;
  direction?: SortDirection;
};

export async function listNotes(input: ListNotesInput): Promise<NotesPage> {
  await applyConfiguredTrashRetention();
  const where: Prisma.NoteWhereInput = {
    ...(input.view === "trash"
      ? { trashedAt: { not: null } }
      : {
          trashedAt: null,
          ...(input.view === "archive"
            ? { archivedAt: { not: null } }
            : { archivedAt: null }),
          ...(input.view === "pinned" ? { pinnedAt: { not: null } } : {}),
        }),
    ...(input.folderId ? { folderId: input.folderId } : {}),
    ...(input.tagIds?.length
      ? { tags: { some: { tagId: { in: input.tagIds } } } }
      : {}),
    ...(input.attachments === "with" ? { attachments: { some: {} } } : {}),
    ...(input.attachments === "without" ? { attachments: { none: {} } } : {}),
  };

  const notes = await prisma.note.findMany({
    where,
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    orderBy: listOrder(input.sort ?? "updated", input.direction ?? "desc"),
    select: summarySelect,
  });

  const hasMore = notes.length > input.limit;
  const visible = hasMore ? notes.slice(0, input.limit) : notes;
  return {
    items: visible.map(serializeSummary),
    nextCursor: hasMore ? (visible.at(-1)?.id ?? null) : null,
  };
}

export async function createNote(value: unknown): Promise<NoteDetail> {
  const input = createNoteInputSchema.parse(value);
  const derived = deriveEditorDocument(EMPTY_EDITOR_DOCUMENT);
  return prisma.$transaction(async (transaction) => {
    await assertFolderExists(transaction, input.folderId ?? null);
    await assertTagsExist(transaction, input.tagIds ?? []);
    const note = await transaction.note.create({
      data: {
        title: input.title?.trim() || "Untitled Note",
        content: derived.content as Prisma.InputJsonValue,
        contentText: derived.plainText,
        contentHtml: derived.sanitizedHtml,
        contentSchema: EDITOR_DOCUMENT_SCHEMA_VERSION,
        folderId: input.folderId ?? null,
        ...(input.tagIds?.length
          ? {
              tags: {
                create: input.tagIds.map((tagId) => ({ tagId })),
              },
            }
          : {}),
      },
      include: noteMetadataInclude,
    });
    return serializeDetail(note, []);
  });
}

export async function getNote(id: string): Promise<NoteDetail> {
  noteIdSchema.parse(id);
  const note = await prisma.note.findUnique({
    where: { id },
    include: noteMetadataInclude,
  });
  if (!note) throw new NoteDomainError("NOTE_NOT_FOUND", "Note not found", 404);
  return serializeDetail(
    note,
    await resolveMentionTargets(prisma, note.content as EditorDocument),
  );
}

export async function updateNote(
  id: string,
  value: unknown,
): Promise<NoteDetail> {
  noteIdSchema.parse(id);
  const input = updateNoteInputSchema.parse(value);
  const derived =
    input.content === undefined
      ? undefined
      : deriveEditorDocument(input.content);

  return prisma.$transaction(async (transaction) => {
    const update = await transaction.note.updateMany({
      where: { id, optimisticVersion: input.expectedVersion },
      data: {
        ...(input.title !== undefined
          ? { title: input.title.slice(0, 500) }
          : {}),
        ...(derived
          ? {
              content: derived.content as Prisma.InputJsonValue,
              contentText: derived.plainText,
              contentHtml: derived.sanitizedHtml,
              contentSchema: EDITOR_DOCUMENT_SCHEMA_VERSION,
            }
          : {}),
        optimisticVersion: { increment: 1 },
      },
    });
    if (update.count === 0) await throwMissingOrConflict(transaction, id);
    if (derived) await reconcileNoteLinks(transaction, id, derived.content);
    return detailFromTransaction(transaction, id);
  });
}

export async function updateNoteOrganization(
  id: string,
  value: unknown,
): Promise<NoteDetail> {
  noteIdSchema.parse(id);
  const input = updateNoteOrganizationInputSchema.parse(value);
  return prisma.$transaction(async (transaction) => {
    if (input.folderId !== undefined) {
      await assertFolderExists(transaction, input.folderId);
    }
    if (input.tagIds) await assertTagsExist(transaction, input.tagIds);
    const update = await transaction.note.updateMany({
      where: { id, optimisticVersion: input.expectedVersion },
      data: {
        ...(input.folderId === undefined ? {} : { folderId: input.folderId }),
        optimisticVersion: { increment: 1 },
      },
    });
    if (update.count === 0) await throwMissingOrConflict(transaction, id);
    if (input.tagIds) {
      await transaction.noteTag.deleteMany({ where: { noteId: id } });
      if (input.tagIds.length > 0) {
        await transaction.noteTag.createMany({
          data: input.tagIds.map((tagId) => ({ noteId: id, tagId })),
        });
      }
    }
    return detailFromTransaction(transaction, id);
  });
}

export async function applyNoteLifecycle(
  id: string,
  value: { action: NoteLifecycleAction; expectedVersion: number },
): Promise<NoteDetail> {
  noteIdSchema.parse(id);
  const input = lifecycleInputSchema.parse(value);
  const now = new Date();
  const data: Prisma.NoteUpdateManyMutationInput = {
    optimisticVersion: { increment: 1 },
    ...(input.action === "pin" ? { pinnedAt: now, archivedAt: null } : {}),
    ...(input.action === "unpin" ? { pinnedAt: null } : {}),
    ...(input.action === "archive" ? { archivedAt: now, pinnedAt: null } : {}),
    ...(input.action === "unarchive" ? { archivedAt: null } : {}),
    ...(input.action === "trash" ? { trashedAt: now, pinnedAt: null } : {}),
    ...(input.action === "restore" ? { trashedAt: null } : {}),
  };
  const stateWhere: Prisma.NoteWhereInput =
    input.action === "restore"
      ? { trashedAt: { not: null } }
      : input.action === "unarchive"
        ? { trashedAt: null, archivedAt: { not: null } }
        : input.action === "trash"
          ? { trashedAt: null }
          : { trashedAt: null };

  return prisma.$transaction(async (transaction) => {
    const update = await transaction.note.updateMany({
      where: {
        id,
        optimisticVersion: input.expectedVersion,
        ...stateWhere,
      },
      data,
    });
    if (update.count === 0) await throwMissingOrConflict(transaction, id);
    return detailFromTransaction(transaction, id);
  });
}

export async function applyBulkNoteAction(value: unknown) {
  const input = bulkNoteInputSchema.parse(value);
  return prisma.$transaction(async (transaction) => {
    if (input.action === "move") {
      await assertFolderExists(transaction, input.folderId ?? null);
    }
    if (input.action === "tag") {
      await assertTagsExist(transaction, input.tagIds ?? []);
    }

    const currentNotes = await transaction.note.findMany({
      where: { id: { in: input.notes.map(({ id }) => id) } },
      select: {
        id: true,
        optimisticVersion: true,
        archivedAt: true,
        trashedAt: true,
      },
    });
    if (currentNotes.length !== input.notes.length) {
      throw new NoteDomainError(
        "BULK_CONFLICT",
        "One or more selected notes no longer exist",
        409,
      );
    }
    const currentById = new Map(currentNotes.map((note) => [note.id, note]));

    for (const selected of input.notes) {
      const current = currentById.get(selected.id)!;
      if (current.optimisticVersion !== selected.expectedVersion) {
        throw bulkConflict();
      }
      const data = bulkMutation(input.action, current, input.folderId);
      const updated = await transaction.note.updateMany({
        where: { id: selected.id, optimisticVersion: selected.expectedVersion },
        data,
      });
      if (updated.count !== 1) throw bulkConflict();
    }

    if (input.action === "tag") {
      await transaction.noteTag.createMany({
        data: input.notes.flatMap(({ id: noteId }) =>
          (input.tagIds ?? []).map((tagId) => ({ noteId, tagId })),
        ),
        skipDuplicates: true,
      });
    }

    const updatedNotes = await transaction.note.findMany({
      where: { id: { in: input.notes.map(({ id }) => id) } },
      select: summarySelect,
    });
    return { items: updatedNotes.map(serializeSummary) };
  });
}

export async function deleteNotePermanently(
  id: string,
  value: unknown,
): Promise<{ id: string; deleted: true }> {
  noteIdSchema.parse(id);
  const input = permanentDeleteInputSchema.parse(value);
  const storageNames = await prisma.$transaction(async (transaction) => {
    const current = await transaction.note.findUnique({
      where: { id },
      include: {
        ...noteMetadataInclude,
        attachments: { select: { storageName: true } },
      },
    });
    if (!current)
      throw new NoteDomainError("NOTE_NOT_FOUND", "Note not found", 404);
    if (current.trashedAt === null) {
      throw new NoteDomainError(
        "NOTE_NOT_TRASHED",
        "Only a trashed note can be permanently deleted",
        409,
        {
          current: serializeDetail(
            current,
            await resolveMentionTargets(
              transaction,
              current.content as EditorDocument,
            ),
          ),
        },
      );
    }
    if (current.optimisticVersion !== input.expectedVersion) {
      await throwMissingOrConflict(transaction, id);
    }
    await transaction.note.delete({ where: { id } });
    return current.attachments.map(({ storageName }) => storageName);
  });
  await deleteStoredFiles(storageNames);
  return { id, deleted: true };
}

async function detailFromTransaction(
  transaction: Prisma.TransactionClient,
  id: string,
): Promise<NoteDetail> {
  const note = await transaction.note.findUniqueOrThrow({
    where: { id },
    include: noteMetadataInclude,
  });
  return serializeDetail(
    note,
    await resolveMentionTargets(transaction, note.content as EditorDocument),
  );
}

async function throwMissingOrConflict(
  transaction: Prisma.TransactionClient,
  id: string,
): Promise<never> {
  const current = await transaction.note.findUnique({
    where: { id },
    include: noteMetadataInclude,
  });
  if (!current)
    throw new NoteDomainError("NOTE_NOT_FOUND", "Note not found", 404);
  throw new NoteDomainError(
    "NOTE_CONFLICT",
    "The note changed in another editor",
    409,
    {
      current: serializeDetail(
        current,
        await resolveMentionTargets(
          transaction,
          current.content as EditorDocument,
        ),
      ),
    },
  );
}

function bulkMutation(
  action: BulkNoteAction,
  current: { archivedAt: Date | null; trashedAt: Date | null },
  folderId?: string | null,
): Prisma.NoteUncheckedUpdateManyInput {
  const version = { optimisticVersion: { increment: 1 as const } };
  if (action === "move") return { ...version, folderId: folderId ?? null };
  if (action === "tag") return version;
  if (action === "pin") {
    if (current.trashedAt)
      throw bulkStateConflict("Trashed notes cannot be pinned");
    return { ...version, pinnedAt: new Date(), archivedAt: null };
  }
  if (action === "archive") {
    if (current.trashedAt)
      throw bulkStateConflict("Trashed notes cannot be archived");
    return { ...version, archivedAt: new Date(), pinnedAt: null };
  }
  if (action === "trash") {
    if (current.trashedAt)
      throw bulkStateConflict("The selection already contains trashed notes");
    return { ...version, trashedAt: new Date(), pinnedAt: null };
  }
  if (current.trashedAt) return { ...version, trashedAt: null };
  if (current.archivedAt) return { ...version, archivedAt: null };
  throw bulkStateConflict("Only archived or trashed notes can be restored");
}

function bulkConflict() {
  return new NoteDomainError(
    "BULK_CONFLICT",
    "The selection changed before the bulk action completed; no notes were changed",
    409,
  );
}

function bulkStateConflict(message: string) {
  return new NoteDomainError("BULK_STATE_INVALID", message, 409);
}

function listOrder(
  sort: Exclude<NoteSort, "relevance">,
  direction: SortDirection,
): Prisma.NoteOrderByWithRelationInput[] {
  if (sort === "title") return [{ title: direction }, { id: direction }];
  if (sort === "created") return [{ createdAt: direction }, { id: direction }];
  return [{ updatedAt: direction }, { id: direction }];
}

const noteMetadataInclude = {
  folder: { select: { id: true, name: true } },
  tags: {
    orderBy: { tag: { normalizedName: "asc" as const } },
    include: {
      tag: { select: { id: true, displayName: true, color: true } },
    },
  },
  _count: { select: { attachments: true } },
} satisfies Prisma.NoteInclude;

const summarySelect = {
  id: true,
  title: true,
  contentText: true,
  optimisticVersion: true,
  folder: { select: { id: true, name: true } },
  tags: {
    orderBy: { tag: { normalizedName: "asc" as const } },
    include: {
      tag: { select: { id: true, displayName: true, color: true } },
    },
  },
  _count: { select: { attachments: true } },
  pinnedAt: true,
  archivedAt: true,
  trashedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.NoteSelect;

type SummaryRecord = Prisma.NoteGetPayload<{ select: typeof summarySelect }>;
type DetailRecord = Prisma.NoteGetPayload<{
  include: typeof noteMetadataInclude;
}>;

function serializeSummary(note: SummaryRecord | DetailRecord): NoteSummary {
  return {
    id: note.id,
    title: note.title || "Untitled Note",
    excerpt: excerpt(note.contentText),
    optimisticVersion: note.optimisticVersion,
    folder: note.folder,
    tags: note.tags.map(({ tag }) => tag),
    attachmentCount: note._count.attachments,
    pinnedAt: note.pinnedAt?.toISOString() ?? null,
    archivedAt: note.archivedAt?.toISOString() ?? null,
    trashedAt: note.trashedAt?.toISOString() ?? null,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

function serializeDetail(
  note: DetailRecord,
  mentionTargets: MentionTarget[],
): NoteDetail {
  return {
    ...serializeSummary(note),
    content: note.content as EditorDocument,
    contentSchema: note.contentSchema,
    mentionTargets,
  };
}

function excerpt(value: string): string {
  const compact = value.replaceAll(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}…` : compact;
}
