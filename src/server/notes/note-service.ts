import { Prisma, type Note } from "@prisma/client";
import { z } from "zod";

import {
  EDITOR_DOCUMENT_SCHEMA_VERSION,
  EMPTY_EDITOR_DOCUMENT,
} from "@/features/notes/document-schema";
import type {
  EditorDocument,
  MentionTarget,
  NoteDetail,
  NoteLifecycleAction,
  NoteSummary,
  NotesPage,
  NotesView,
} from "@/features/notes/types";
import { prisma } from "@/server/db";

import { deriveEditorDocument } from "./derive-document";
import { NoteDomainError } from "./note-errors";
import { reconcileNoteLinks, resolveMentionTargets } from "./note-links";

const noteIdSchema = z.string().uuid();
const cursorSchema = z.string().uuid();

export const createNoteInputSchema = z.object({
  title: z.string().trim().max(500).optional(),
});

export const updateNoteInputSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    title: z.string().max(500).optional(),
    content: z.unknown().optional(),
  })
  .refine((input) => input.title !== undefined || input.content !== undefined, {
    message: "At least one note field must be supplied",
  });

export const lifecycleInputSchema = z.object({
  action: z.enum(["pin", "unpin", "trash", "restore"]),
  expectedVersion: z.number().int().positive(),
});

export const permanentDeleteInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

export const listNotesInputSchema = z.object({
  view: z.enum(["all", "pinned", "trash"]).default("all"),
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

export async function listNotes(input: {
  view: NotesView;
  cursor?: string;
  limit: number;
}): Promise<NotesPage> {
  const where: Prisma.NoteWhereInput =
    input.view === "trash"
      ? { trashedAt: { not: null } }
      : {
          trashedAt: null,
          archivedAt: null,
          ...(input.view === "pinned" ? { pinnedAt: { not: null } } : {}),
        };

  const notes = await prisma.note.findMany({
    where,
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    orderBy:
      input.view === "trash"
        ? [{ trashedAt: "desc" }, { id: "desc" }]
        : [{ pinnedAt: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
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
  const note = await prisma.note.create({
    data: {
      title: input.title?.trim() || "Untitled Note",
      content: derived.content as Prisma.InputJsonValue,
      contentText: derived.plainText,
      contentHtml: derived.sanitizedHtml,
      contentSchema: EDITOR_DOCUMENT_SCHEMA_VERSION,
    },
  });

  return serializeDetail(note, []);
}

export async function getNote(id: string): Promise<NoteDetail> {
  noteIdSchema.parse(id);
  const note = await prisma.note.findUnique({ where: { id } });
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
    if (derived) {
      await reconcileNoteLinks(transaction, id, derived.content);
    }
    const note = await transaction.note.findUniqueOrThrow({ where: { id } });
    return serializeDetail(
      note,
      await resolveMentionTargets(transaction, note.content as EditorDocument),
    );
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
    ...(input.action === "pin" ? { pinnedAt: now } : {}),
    ...(input.action === "unpin" ? { pinnedAt: null } : {}),
    ...(input.action === "trash" ? { trashedAt: now, pinnedAt: null } : {}),
    ...(input.action === "restore" ? { trashedAt: null } : {}),
  };

  return prisma.$transaction(async (transaction) => {
    const update = await transaction.note.updateMany({
      where: { id, optimisticVersion: input.expectedVersion },
      data,
    });
    if (update.count === 0) await throwMissingOrConflict(transaction, id);
    const note = await transaction.note.findUniqueOrThrow({ where: { id } });
    return serializeDetail(
      note,
      await resolveMentionTargets(transaction, note.content as EditorDocument),
    );
  });
}

export async function deleteNotePermanently(
  id: string,
  value: unknown,
): Promise<{ id: string; deleted: true }> {
  noteIdSchema.parse(id);
  const input = permanentDeleteInputSchema.parse(value);

  return prisma.$transaction(async (transaction) => {
    const deleted = await transaction.note.deleteMany({
      where: {
        id,
        optimisticVersion: input.expectedVersion,
        trashedAt: { not: null },
      },
    });
    if (deleted.count === 1) return { id, deleted: true as const };

    const current = await transaction.note.findUnique({ where: { id } });
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
    await throwMissingOrConflict(transaction, id);
    throw new Error("Unreachable permanent-delete state");
  });
}

async function throwMissingOrConflict(
  transaction: Prisma.TransactionClient,
  id: string,
) {
  const current = await transaction.note.findUnique({ where: { id } });
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

const summarySelect = {
  id: true,
  title: true,
  contentText: true,
  optimisticVersion: true,
  pinnedAt: true,
  archivedAt: true,
  trashedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.NoteSelect;

type SummaryRecord = Prisma.NoteGetPayload<{ select: typeof summarySelect }>;

function serializeSummary(note: SummaryRecord): NoteSummary {
  return {
    id: note.id,
    title: note.title || "Untitled Note",
    excerpt: excerpt(note.contentText),
    optimisticVersion: note.optimisticVersion,
    pinnedAt: note.pinnedAt?.toISOString() ?? null,
    archivedAt: note.archivedAt?.toISOString() ?? null,
    trashedAt: note.trashedAt?.toISOString() ?? null,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

function serializeDetail(
  note: Note,
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
