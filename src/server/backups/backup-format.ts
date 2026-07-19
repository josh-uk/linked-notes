import { z } from "zod";

import packageJson from "../../../package.json";
import {
  EDITOR_DOCUMENT_SCHEMA_VERSION,
  editorDocumentSchema,
  parseEditorDocument,
} from "@/features/notes/document-schema";
import { extractMentions } from "@/features/notes/mention-document";
import type { EditorDocument, EditorNode } from "@/features/notes/types";
import { NoteDomainError } from "@/server/notes/note-errors";

export const BACKUP_FORMAT = "linked-notes-backup";
export const BACKUP_SCHEMA_VERSION = 1;
export const BACKUP_EXTENSION = ".linked-notes-backup.tar.gz";
export const MANIFEST_PATH = "manifest.json";
export const MANIFEST_CHECKSUM_PATH = "manifest.sha256";
export const APPLICATION_VERSION = packageJson.version;

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const checksumSchema = z.string().regex(/^[0-9a-f]{64}$/);
const jsonValueSchema = z.json();

const folderSchema = z
  .object({
    id: uuidSchema,
    name: z.string().min(1).max(200),
    parentId: uuidSchema.nullable(),
    sortOrder: z.number().int(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

const tagSchema = z
  .object({
    id: uuidSchema,
    normalizedName: z.string().min(1).max(100),
    displayName: z.string().min(1).max(100),
    color: z.string().max(20).nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

const noteSchema = z
  .object({
    id: uuidSchema,
    title: z.string().max(500),
    content: editorDocumentSchema,
    contentSchema: z.number().int().positive(),
    optimisticVersion: z.number().int().positive(),
    folderId: uuidSchema.nullable(),
    pinnedAt: timestampSchema.nullable(),
    archivedAt: timestampSchema.nullable(),
    trashedAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

const noteTagSchema = z
  .object({ noteId: uuidSchema, tagId: uuidSchema })
  .strict();

const noteLinkSchema = z
  .object({
    sourceNoteId: uuidSchema,
    targetNoteId: uuidSchema.nullable(),
    targetKey: uuidSchema,
    mentionId: uuidSchema,
    context: z.string().max(500).nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

const attachmentSchema = z
  .object({
    id: uuidSchema,
    noteId: uuidSchema,
    originalName: z.string().min(1).max(500),
    storageName: uuidSchema,
    archivePath: z.string().min(1).max(200),
    mimeType: z.string().min(1).max(255),
    byteSize: z.number().int().positive(),
    checksumSha256: checksumSchema,
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    createdAt: timestampSchema,
  })
  .strict();

const settingSchema = z
  .object({
    key: z.string().min(1).max(100),
    type: z.enum(["STRING", "NUMBER", "BOOLEAN", "JSON"]),
    value: jsonValueSchema,
    version: z.number().int().positive(),
    updatedAt: timestampSchema,
  })
  .strict();

const schemaMetadataSchema = z
  .object({
    id: z.literal(1),
    dataSchemaVersion: z.number().int().positive(),
    backupSchemaVersion: z.number().int().positive(),
    updatedAt: timestampSchema,
  })
  .strict();

export const backupManifestSchema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    backupSchemaVersion: z.literal(BACKUP_SCHEMA_VERSION),
    dataSchemaVersion: z.number().int().positive(),
    applicationVersion: z.string().min(1).max(50),
    createdAt: timestampSchema,
    entities: z
      .object({
        schemaMetadata: schemaMetadataSchema,
        folders: z.array(folderSchema).max(50_000),
        tags: z.array(tagSchema).max(50_000),
        notes: z.array(noteSchema).max(1_000_000),
        noteTags: z.array(noteTagSchema).max(5_000_000),
        noteLinks: z.array(noteLinkSchema).max(5_000_000),
        settings: z.array(settingSchema).max(10_000),
        attachments: z.array(attachmentSchema).max(1_000_000),
      })
      .strict(),
  })
  .strict()
  .superRefine(validateManifestRelations);

export type BackupManifest = z.infer<typeof backupManifestSchema>;

export function parseBackupManifest(value: unknown) {
  return backupManifestSchema.parse(value);
}

export function canonicalManifestBytes(manifest: BackupManifest) {
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
}

export function attachmentArchivePath(attachmentId: string) {
  uuidSchema.parse(attachmentId);
  return `attachments/${attachmentId}`;
}

export function assertSafeArchivePath(value: string) {
  if (
    !value ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value)
  ) {
    throw unsafeArchivePath();
  }
  const segments = value.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw unsafeArchivePath();
  }
  return value;
}

export function remapEditorDocumentTargets(
  value: EditorDocument,
  targetIds: Map<string, string>,
) {
  function visit(node: EditorNode): EditorNode {
    return {
      ...node,
      ...(node.attrs
        ? {
            attrs:
              node.type === "mention" && typeof node.attrs.id === "string"
                ? {
                    ...node.attrs,
                    id: targetIds.get(node.attrs.id) ?? node.attrs.id,
                  }
                : { ...node.attrs },
          }
        : {}),
      ...(node.marks
        ? {
            marks: node.marks.map((mark) => ({
              ...mark,
              ...(mark.attrs ? { attrs: { ...mark.attrs } } : {}),
            })),
          }
        : {}),
      ...(node.content ? { content: node.content.map(visit) } : {}),
    };
  }
  return parseEditorDocument(visit(value));
}

function validateManifestRelations(
  manifest: {
    backupSchemaVersion: number;
    dataSchemaVersion: number;
    entities: BackupManifest["entities"];
  },
  context: z.RefinementCtx,
) {
  const entities = manifest.entities;
  if (
    entities.schemaMetadata.backupSchemaVersion !==
      manifest.backupSchemaVersion ||
    entities.schemaMetadata.dataSchemaVersion !== manifest.dataSchemaVersion
  ) {
    issue(context, "Manifest and schema metadata versions do not match");
  }

  unique(context, entities.folders, ({ id }) => id, "folder IDs");
  unique(context, entities.tags, ({ id }) => id, "tag IDs");
  unique(
    context,
    entities.tags,
    ({ normalizedName }) => normalizedName,
    "tag names",
  );
  for (const tag of entities.tags) {
    if (tag.normalizedName !== normalizeName(tag.displayName)) {
      issue(context, `Tag ${tag.id} has an invalid normalized name`);
    }
  }
  unique(context, entities.notes, ({ id }) => id, "note IDs");
  unique(context, entities.attachments, ({ id }) => id, "attachment IDs");
  unique(
    context,
    entities.attachments,
    ({ storageName }) => storageName,
    "attachment storage names",
  );
  unique(context, entities.settings, ({ key }) => key, "setting keys");
  unique(
    context,
    entities.noteTags,
    ({ noteId, tagId }) => `${noteId}:${tagId}`,
    "note/tag relationships",
  );
  unique(
    context,
    entities.noteLinks,
    ({ sourceNoteId, mentionId }) => `${sourceNoteId}:${mentionId}`,
    "note link identities",
  );

  const folderIds = new Set(entities.folders.map(({ id }) => id));
  const folders = new Map(
    entities.folders.map((folder) => [folder.id, folder]),
  );
  unique(
    context,
    entities.folders,
    ({ parentId, name }) => `${parentId ?? "root"}\0${normalizeName(name)}`,
    "folder names within the same parent",
  );
  for (const folder of entities.folders) {
    if (folder.parentId && !folderIds.has(folder.parentId)) {
      issue(context, `Folder ${folder.id} references a missing parent`);
    }
    const seen = new Set<string>([folder.id]);
    let current = folder;
    let depth = 1;
    while (current.parentId) {
      if (seen.has(current.parentId)) {
        issue(context, `Folder ${folder.id} contains a cycle`);
        break;
      }
      seen.add(current.parentId);
      const parent = folders.get(current.parentId);
      if (!parent) break;
      current = parent;
      depth += 1;
      if (depth > 6) {
        issue(context, `Folder ${folder.id} exceeds the supported depth`);
        break;
      }
    }
  }

  const noteIds = new Set(entities.notes.map(({ id }) => id));
  const tagIds = new Set(entities.tags.map(({ id }) => id));
  const noteById = new Map(entities.notes.map((note) => [note.id, note]));
  for (const note of entities.notes) {
    if (note.folderId && !folderIds.has(note.folderId)) {
      issue(context, `Note ${note.id} references a missing folder`);
    }
    if (note.contentSchema > EDITOR_DOCUMENT_SCHEMA_VERSION) {
      issue(context, `Note ${note.id} uses an unsupported editor schema`);
    }
  }
  for (const relation of entities.noteTags) {
    if (!noteIds.has(relation.noteId) || !tagIds.has(relation.tagId)) {
      issue(context, "A note/tag relationship references a missing entity");
    }
  }

  const linksBySource = new Map<string, Map<string, string>>();
  for (const note of entities.notes) {
    linksBySource.set(
      note.id,
      new Map(
        extractMentions(note.content as EditorDocument).map((mention) => [
          mention.mentionId,
          mention.targetId,
        ]),
      ),
    );
  }
  const linkCountBySource = new Map<string, number>();
  for (const link of entities.noteLinks) {
    linkCountBySource.set(
      link.sourceNoteId,
      (linkCountBySource.get(link.sourceNoteId) ?? 0) + 1,
    );
    if (!noteIds.has(link.sourceNoteId)) {
      issue(context, "A note link references a missing source note");
      continue;
    }
    if (link.targetNoteId && !noteIds.has(link.targetNoteId)) {
      issue(context, "A note link references a missing live target note");
    }
    if (link.targetNoteId && link.targetNoteId !== link.targetKey) {
      issue(context, "A live note link target does not match its durable key");
    }
    if (
      linksBySource.get(link.sourceNoteId)?.get(link.mentionId) !==
      link.targetKey
    ) {
      issue(context, "A note link does not match its source document mention");
    }
  }
  for (const [sourceNoteId, mentions] of linksBySource) {
    if (mentions.size !== (linkCountBySource.get(sourceNoteId) ?? 0)) {
      issue(context, `Note ${sourceNoteId} has unreconciled mention links`);
    }
  }

  for (const attachment of entities.attachments) {
    if (!noteById.has(attachment.noteId)) {
      issue(context, `Attachment ${attachment.id} references a missing note`);
    }
    try {
      assertSafeArchivePath(attachment.archivePath);
      if (attachment.archivePath !== attachmentArchivePath(attachment.id)) {
        issue(
          context,
          `Attachment ${attachment.id} has a non-deterministic path`,
        );
      }
    } catch {
      issue(context, `Attachment ${attachment.id} has an unsafe path`);
    }
  }
}

function unique<T>(
  context: z.RefinementCtx,
  values: T[],
  key: (value: T) => string,
  label: string,
) {
  const keys = values.map(key);
  if (new Set(keys).size !== keys.length) issue(context, `Duplicate ${label}`);
}

function issue(context: z.RefinementCtx, message: string) {
  context.addIssue({ code: "custom", message });
}

function normalizeName(value: string) {
  return value.trim().replaceAll(/\s+/g, " ").toLocaleLowerCase();
}

function unsafeArchivePath() {
  return new NoteDomainError(
    "BACKUP_PATH_UNSAFE",
    "The backup contained an unsafe archive path",
    400,
  );
}
