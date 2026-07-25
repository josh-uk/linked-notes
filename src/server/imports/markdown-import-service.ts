import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { EDITOR_DOCUMENT_SCHEMA_VERSION } from "@/features/notes/document-schema";
import { prisma } from "@/server/db";
import { deriveEditorDocument } from "@/server/notes/derive-document";
import { NoteDomainError } from "@/server/notes/note-errors";
import { reconcileNoteLinks } from "@/server/notes/note-links";

import {
  parseMarkdownDocument,
  remapImportedMentions,
} from "./markdown-document";

const MAX_FILE_CHARACTERS = 2_000_000;
const MAX_TOTAL_CHARACTERS = 20_000_000;
const importFileSchema = z
  .object({
    path: z.string().min(1).max(1_000),
    content: z.string().max(MAX_FILE_CHARACTERS),
  })
  .strict();

export const markdownImportInputSchema = z
  .object({
    files: z.array(importFileSchema).min(1).max(100),
    commit: z.boolean().default(false),
    createCopies: z.boolean().default(false),
  })
  .strict()
  .superRefine((input, context) => {
    const normalized = new Set<string>();
    let total = 0;
    for (const file of input.files) {
      total += file.content.length;
      const path = safeImportPath(file.path);
      if (!path.toLocaleLowerCase().endsWith(".md")) {
        context.addIssue({
          code: "custom",
          message: "Only Markdown files can be imported",
        });
      }
      const key = path.toLocaleLowerCase();
      if (normalized.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Import paths must be unique",
        });
      }
      normalized.add(key);
    }
    if (total > MAX_TOTAL_CHARACTERS) {
      context.addIssue({
        code: "custom",
        message: "The import exceeds the 20 MB limit",
      });
    }
  });

export async function importMarkdownFiles(value: unknown) {
  const input = markdownImportInputSchema.parse(value);
  const parsed = input.files.map((file) => {
    const path = safeImportPath(file.path);
    return {
      path,
      folderSegments: path.split("/").slice(0, -1),
      document: parseMarkdownDocument(path, file.content),
    };
  });
  const sourceKeys = parsed.map(({ document }) => sourceKey(document));
  if (new Set(sourceKeys).size !== sourceKeys.length) {
    throw new NoteDomainError(
      "IMPORT_SOURCE_DUPLICATE",
      "The selected files contain the same imported note more than once",
      400,
    );
  }
  const existing = await findExistingSources(parsed);
  const preview = parsed.map((file) => {
    const match = existing.get(sourceKey(file.document));
    return {
      path: file.path,
      title: file.document.title,
      folder: file.folderSegments.join(" / ") || null,
      tags: file.document.tags,
      source: file.document.sourceType,
      status:
        match && !input.createCopies ? ("existing" as const) : ("new" as const),
      existingNoteId: match?.id ?? null,
    };
  });
  if (!input.commit) {
    return {
      committed: false as const,
      files: preview,
      summary: summarize(preview),
    };
  }

  const result = await prisma.$transaction(
    async (transaction) => {
      const ids = new Map<string, string>();
      for (const file of parsed) {
        const match = existing.get(sourceKey(file.document));
        if (file.document.originalNoteId) {
          ids.set(
            file.document.originalNoteId,
            match && !input.createCopies ? match.id : randomUUID(),
          );
        }
      }

      const folderIds = await ensureFolders(transaction, parsed);
      const createdIds: string[] = [];
      const skippedIds: string[] = [];
      for (const file of parsed) {
        const match = existing.get(sourceKey(file.document));
        if (match && !input.createCopies) {
          skippedIds.push(match.id);
          continue;
        }
        const id =
          (file.document.originalNoteId
            ? ids.get(file.document.originalNoteId)
            : null) ?? randomUUID();
        const content = remapImportedMentions(file.document.content, ids);
        const derived = deriveEditorDocument(content);
        const tagIds = await ensureTags(transaction, file.document.tags);
        const createdAt = file.document.createdAt ?? new Date();
        const updatedAt = file.document.updatedAt ?? createdAt;
        const sourceId = input.createCopies
          ? `${file.document.sourceId}:copy:${id}`
          : file.document.sourceId;
        await transaction.note.create({
          data: {
            id,
            title: file.document.title,
            content: derived.content as Prisma.InputJsonValue,
            contentText: derived.plainText,
            contentHtml: derived.sanitizedHtml,
            contentSchema: EDITOR_DOCUMENT_SCHEMA_VERSION,
            folderId: folderIds.get(folderKey(file.folderSegments)) ?? null,
            sourceType: file.document.sourceType,
            sourceId,
            createdAt,
            updatedAt,
            ...(tagIds.length
              ? {
                  tags: {
                    create: tagIds.map((tagId) => ({ tagId })),
                  },
                }
              : {}),
          },
        });
        createdIds.push(id);
      }
      for (const id of createdIds) {
        const note = await transaction.note.findUniqueOrThrow({
          where: { id },
          select: { content: true },
        });
        await reconcileNoteLinks(
          transaction,
          id,
          note.content as ReturnType<typeof deriveEditorDocument>["content"],
        );
      }
      return { createdIds, skippedIds };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 120_000,
    },
  );

  return {
    committed: true as const,
    files: preview,
    summary: {
      ...summarize(preview),
      created: result.createdIds.length,
      skipped: result.skippedIds.length,
    },
    createdNoteIds: result.createdIds,
  };
}

async function findExistingSources(
  files: Array<{ document: ReturnType<typeof parseMarkdownDocument> }>,
) {
  const pairs = files.map(({ document }) => ({
    sourceType: document.sourceType,
    sourceId: document.sourceId,
  }));
  const notes = await prisma.note.findMany({
    where: { OR: pairs },
    select: { id: true, sourceType: true, sourceId: true },
  });
  return new Map(
    notes.map((note) => [
      `${note.sourceType ?? ""}\0${note.sourceId ?? ""}`,
      note,
    ]),
  );
}

async function ensureFolders(
  transaction: Prisma.TransactionClient,
  files: Array<{ folderSegments: string[] }>,
) {
  const folders = await transaction.folder.findMany({
    select: { id: true, parentId: true, name: true },
  });
  const ids = new Map(
    folders.map((folder) => [
      `${folder.parentId ?? "root"}\0${normalizeName(folder.name)}`,
      folder.id,
    ]),
  );
  const byPath = new Map<string, string>();
  const paths = [
    ...new Map(
      files.map(({ folderSegments }) => [
        folderKey(folderSegments),
        folderSegments,
      ]),
    ).values(),
  ].sort((left, right) => left.length - right.length);
  for (const segments of paths) {
    let parentId: string | null = null;
    const traversed: string[] = [];
    for (const segment of segments) {
      traversed.push(segment);
      const location = `${parentId ?? "root"}\0${normalizeName(segment)}`;
      let id = ids.get(location);
      if (!id) {
        id = (
          await transaction.folder.create({
            data: { name: segment, parentId },
            select: { id: true },
          })
        ).id;
        ids.set(location, id);
      }
      parentId = id;
      byPath.set(folderKey(traversed), id);
    }
  }
  return byPath;
}

async function ensureTags(
  transaction: Prisma.TransactionClient,
  names: string[],
) {
  const ids: string[] = [];
  for (const displayName of names) {
    const normalizedName = normalizeName(displayName);
    const existing = await transaction.tag.findUnique({
      where: { normalizedName },
      select: { id: true },
    });
    const id =
      existing?.id ??
      (
        await transaction.tag.create({
          data: { displayName, normalizedName },
          select: { id: true },
        })
      ).id;
    ids.push(id);
  }
  return ids;
}

function safeImportPath(value: string) {
  const normalized = value.normalize("NFC").replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    segments.length > 7 ||
    segments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        segment.length > 200 ||
        /[\u0000-\u001f\u007f]/.test(segment),
    )
  ) {
    throw new NoteDomainError(
      "IMPORT_PATH_UNSAFE",
      "The import contained an unsafe path",
      400,
    );
  }
  return segments.join("/");
}

function folderKey(segments: string[]) {
  return segments.map(normalizeName).join("/");
}

function normalizeName(value: string) {
  return value.trim().replaceAll(/\s+/g, " ").toLocaleLowerCase();
}

function sourceKey(document: ReturnType<typeof parseMarkdownDocument>) {
  return `${document.sourceType}\0${document.sourceId}`;
}

function summarize(
  files: Array<{ status: "new" | "existing"; source: string }>,
) {
  return {
    total: files.length,
    new: files.filter(({ status }) => status === "new").length,
    existing: files.filter(({ status }) => status === "existing").length,
    appleNotes: files.filter(({ source }) => source === "apple-notes").length,
  };
}
