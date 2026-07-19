import { randomUUID } from "node:crypto";
import { mkdir, rename } from "node:fs/promises";
import path from "node:path";

import { Prisma, SettingType } from "@prisma/client";
import { z } from "zod";

import type { EditorDocument } from "@/features/notes/types";
import { readServerEnvironment } from "@/lib/env";
import { prisma } from "@/server/db";
import { deleteStoredFiles } from "@/server/attachments/attachment-storage";
import { NoteDomainError } from "@/server/notes/note-errors";
import { deriveEditorDocument } from "@/server/notes/derive-document";

import {
  generateWorkspaceBackup,
  removeSafetyBackup,
  type GeneratedBackup,
} from "./backup-archive";
import {
  type BackupManifest,
  remapEditorDocumentTargets,
} from "./backup-format";
import {
  removeStagedBackup,
  stageAndValidateBackup,
  type StagedBackup,
} from "./backup-validation";

export const restoreBackupInputSchema = z
  .object({
    mode: z.enum(["merge", "replace"]),
    confirmation: z.string().max(20).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.mode === "replace" && input.confirmation !== "REPLACE") {
      context.addIssue({
        code: "custom",
        message: "Replace restore requires explicit confirmation",
      });
    }
  });

type RestoreMode = z.infer<typeof restoreBackupInputSchema>["mode"];

type CurrentWorkspace = Awaited<ReturnType<typeof readCurrentWorkspace>>;

type RestorePlan = {
  mode: RestoreMode;
  folderCreates: BackupManifest["entities"]["folders"];
  tagCreates: BackupManifest["entities"]["tags"];
  noteCreates: Array<
    Omit<BackupManifest["entities"]["notes"][number], "content"> & {
      content: ReturnType<typeof remapEditorDocumentTargets>;
      contentText: string;
      contentHtml: string;
    }
  >;
  noteTagCreates: BackupManifest["entities"]["noteTags"];
  noteLinkCreates: BackupManifest["entities"]["noteLinks"];
  attachmentCreates: Array<
    BackupManifest["entities"]["attachments"][number] & {
      storageName: string;
    }
  >;
  settingCreates: BackupManifest["entities"]["settings"];
  storageNameByAttachmentId: Map<string, string>;
  summary: {
    foldersCreated: number;
    foldersMatched: number;
    tagsCreated: number;
    tagsMatched: number;
    notesCreated: number;
    noteIdsRemapped: number;
    attachmentsCreated: number;
    attachmentIdsRemapped: number;
    missingTargetKeysRemapped: number;
    settingsImported: number;
  };
};

let restoreInProgress = false;

export async function restoreWorkspaceBackup(
  source: AsyncIterable<Uint8Array>,
  value: unknown,
  options: { contentLength: number | null },
) {
  const input = restoreBackupInputSchema.parse(value);
  if (restoreInProgress) {
    throw new NoteDomainError(
      "RESTORE_ALREADY_RUNNING",
      "Another workspace restore is already running",
      409,
    );
  }
  restoreInProgress = true;
  let staged: StagedBackup | null = null;
  let safetyBackup: GeneratedBackup | null = null;
  let committed = false;
  const movedStorageNames: string[] = [];
  try {
    staged = await stageAndValidateBackup(source, options);
    const current = await readCurrentWorkspace();
    const plan = buildRestorePlan(staged.manifest, current, input.mode);
    if (input.mode === "replace") {
      safetyBackup = await generateWorkspaceBackup({ safety: true });
    }
    await moveStagedAttachments(staged, plan, movedStorageNames);
    try {
      await applyRestorePlan(plan, staged.manifest);
      committed = true;
    } catch (error) {
      await deleteStoredFiles(movedStorageNames);
      throw error;
    }

    if (input.mode === "replace") {
      await deleteStoredFiles(
        current.attachments.map(({ storageName }) => storageName),
      );
    }
    const sourceApplicationVersion = staged.manifest.applicationVersion;
    const archive = {
      compressedBytes: staged.compressedBytes,
      expandedBytes: staged.expandedBytes,
      entryCount: staged.entryCount,
    };
    await removeStagedBackup(staged).catch((error) => {
      console.warn("restore_staging_cleanup_failed", {
        error: error instanceof Error ? error.name : "unknown",
      });
    });
    staged = null;
    return {
      restored: true as const,
      mode: input.mode,
      source: {
        applicationVersion: sourceApplicationVersion,
      },
      archive,
      summary: plan.summary,
      safetyBackup: safetyBackup
        ? {
            name: safetyBackup.filename,
            byteSize: safetyBackup.byteSize,
            checksumSha256: safetyBackup.checksumSha256,
            downloadUrl: `/api/backups/safety/${encodeURIComponent(safetyBackup.filename)}`,
          }
        : null,
    };
  } catch (error) {
    if (!committed && safetyBackup) await removeSafetyBackup(safetyBackup);
    if (staged) await removeStagedBackup(staged).catch(() => undefined);
    throw error;
  } finally {
    restoreInProgress = false;
  }
}

async function readCurrentWorkspace() {
  const [folders, tags, notes, attachments, settings] = await Promise.all([
    prisma.folder.findMany({ orderBy: { id: "asc" } }),
    prisma.tag.findMany({ orderBy: { id: "asc" } }),
    prisma.note.findMany({ select: { id: true } }),
    prisma.attachment.findMany({
      select: { id: true, storageName: true },
    }),
    prisma.setting.findMany({ select: { key: true } }),
  ]);
  return { folders, tags, notes, attachments, settings };
}

function buildRestorePlan(
  manifest: BackupManifest,
  current: CurrentWorkspace,
  mode: RestoreMode,
): RestorePlan {
  const replace = mode === "replace";
  const usedNoteIds = new Set(replace ? [] : current.notes.map(({ id }) => id));
  const usedTagIds = new Set(replace ? [] : current.tags.map(({ id }) => id));
  const usedFolderIds = new Set(
    replace ? [] : current.folders.map(({ id }) => id),
  );
  const usedAttachmentIds = new Set(
    replace ? [] : current.attachments.map(({ id }) => id),
  );
  const usedStorageNames = new Set(
    current.attachments.map(({ storageName }) => storageName),
  );

  const noteIds = allocateEntityIds(
    manifest.entities.notes.map(({ id }) => id),
    usedNoteIds,
  );
  const attachmentIds = allocateEntityIds(
    manifest.entities.attachments.map(({ id }) => id),
    usedAttachmentIds,
  );
  const tagPlan = planTags(manifest, current, replace, usedTagIds);
  const folderPlan = planFolders(manifest, current, replace, usedFolderIds);

  const targetIds = new Map(noteIds);
  let missingTargetKeysRemapped = 0;
  const durableKeys = new Set([
    ...(replace ? [] : current.notes.map(({ id }) => id)),
    ...noteIds.values(),
  ]);
  for (const link of manifest.entities.noteLinks) {
    if (targetIds.has(link.targetKey)) continue;
    if (durableKeys.has(link.targetKey)) {
      const mapped = allocateUuid(durableKeys);
      targetIds.set(link.targetKey, mapped);
      missingTargetKeysRemapped += 1;
    } else {
      durableKeys.add(link.targetKey);
      targetIds.set(link.targetKey, link.targetKey);
    }
  }

  const storageNameByAttachmentId = new Map<string, string>();
  for (const attachment of manifest.entities.attachments) {
    storageNameByAttachmentId.set(
      attachment.id,
      allocateUuid(usedStorageNames),
    );
  }

  const noteCreates = manifest.entities.notes.map((note) => {
    const content = remapEditorDocumentTargets(
      note.content as EditorDocument,
      targetIds,
    );
    const derived = deriveEditorDocument(content);
    return {
      ...note,
      id: noteIds.get(note.id)!,
      folderId: note.folderId ? folderPlan.ids.get(note.folderId)! : null,
      content,
      contentText: derived.plainText,
      contentHtml: derived.sanitizedHtml,
    };
  });
  const noteTagCreates = manifest.entities.noteTags.map((relation) => ({
    noteId: noteIds.get(relation.noteId)!,
    tagId: tagPlan.ids.get(relation.tagId)!,
  }));
  const noteLinkCreates = manifest.entities.noteLinks.map((link) => ({
    ...link,
    sourceNoteId: noteIds.get(link.sourceNoteId)!,
    targetNoteId: link.targetNoteId ? noteIds.get(link.targetNoteId)! : null,
    targetKey: targetIds.get(link.targetKey)!,
  }));
  const attachmentCreates = manifest.entities.attachments.map((attachment) => ({
    ...attachment,
    id: attachmentIds.get(attachment.id)!,
    noteId: noteIds.get(attachment.noteId)!,
    storageName: storageNameByAttachmentId.get(attachment.id)!,
  }));
  const currentSettingKeys = new Set(
    replace ? [] : current.settings.map(({ key }) => key),
  );
  const settingCreates = manifest.entities.settings.filter(
    ({ key }) => !currentSettingKeys.has(key),
  );

  return {
    mode,
    folderCreates: folderPlan.creates,
    tagCreates: tagPlan.creates,
    noteCreates,
    noteTagCreates,
    noteLinkCreates,
    attachmentCreates,
    settingCreates,
    storageNameByAttachmentId,
    summary: {
      foldersCreated: folderPlan.creates.length,
      foldersMatched:
        manifest.entities.folders.length - folderPlan.creates.length,
      tagsCreated: tagPlan.creates.length,
      tagsMatched: manifest.entities.tags.length - tagPlan.creates.length,
      notesCreated: noteCreates.length,
      noteIdsRemapped: countChanged(noteIds),
      attachmentsCreated: attachmentCreates.length,
      attachmentIdsRemapped: countChanged(attachmentIds),
      missingTargetKeysRemapped,
      settingsImported: settingCreates.length,
    },
  };
}

function planTags(
  manifest: BackupManifest,
  current: CurrentWorkspace,
  replace: boolean,
  usedIds: Set<string>,
) {
  const byName = new Map(
    replace
      ? []
      : current.tags.map((tag) => [tag.normalizedName, tag.id] as const),
  );
  const ids = new Map<string, string>();
  const creates: BackupManifest["entities"]["tags"] = [];
  for (const tag of manifest.entities.tags) {
    const existing = byName.get(tag.normalizedName);
    if (existing) {
      ids.set(tag.id, existing);
      continue;
    }
    const id = allocatePreferredUuid(tag.id, usedIds);
    ids.set(tag.id, id);
    byName.set(tag.normalizedName, id);
    creates.push({ ...tag, id });
  }
  return { ids, creates };
}

function planFolders(
  manifest: BackupManifest,
  current: CurrentWorkspace,
  replace: boolean,
  usedIds: Set<string>,
) {
  const ids = new Map<string, string>();
  const creates: BackupManifest["entities"]["folders"] = [];
  const byLocation = new Map<string, string>();
  if (!replace) {
    for (const folder of current.folders) {
      byLocation.set(folderLocation(folder.parentId, folder.name), folder.id);
    }
  }
  for (const folder of foldersByDepth(manifest.entities.folders)) {
    const parentId = folder.parentId ? ids.get(folder.parentId)! : null;
    const location = folderLocation(parentId, folder.name);
    const existing = byLocation.get(location);
    if (existing) {
      ids.set(folder.id, existing);
      continue;
    }
    const id = allocatePreferredUuid(folder.id, usedIds);
    ids.set(folder.id, id);
    byLocation.set(location, id);
    creates.push({ ...folder, id, parentId });
  }
  return { ids, creates };
}

function foldersByDepth(folders: BackupManifest["entities"]["folders"]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const depth = (folder: (typeof folders)[number]) => {
    let value = 0;
    let current: typeof folder | undefined = folder;
    while (current?.parentId) {
      value += 1;
      current = byId.get(current.parentId);
    }
    return value;
  };
  return [...folders].sort(
    (left, right) =>
      depth(left) - depth(right) || left.id.localeCompare(right.id),
  );
}

function folderLocation(parentId: string | null, name: string) {
  return `${parentId ?? "root"}\0${name.trim().toLocaleLowerCase()}`;
}

function allocateEntityIds(values: string[], used: Set<string>) {
  const map = new Map<string, string>();
  for (const value of values)
    map.set(value, allocatePreferredUuid(value, used));
  return map;
}

function allocatePreferredUuid(value: string, used: Set<string>) {
  if (!used.has(value)) {
    used.add(value);
    return value;
  }
  return allocateUuid(used);
}

function allocateUuid(used: Set<string>) {
  let value = randomUUID();
  while (used.has(value)) value = randomUUID();
  used.add(value);
  return value;
}

function countChanged(map: Map<string, string>) {
  let count = 0;
  for (const [before, after] of map) if (before !== after) count += 1;
  return count;
}

async function moveStagedAttachments(
  staged: StagedBackup,
  plan: RestorePlan,
  movedStorageNames: string[],
) {
  const root = path.resolve(readServerEnvironment().ATTACHMENTS_DIR);
  await mkdir(root, { recursive: true, mode: 0o700 });
  try {
    for (const attachment of staged.manifest.entities.attachments) {
      const stored = staged.attachments.get(attachment.id)!;
      const storageName = plan.storageNameByAttachmentId.get(attachment.id)!;
      await rename(stored.filePath, path.join(root, storageName));
      movedStorageNames.push(storageName);
    }
  } catch (error) {
    await deleteStoredFiles(movedStorageNames);
    throw error;
  }
}

async function applyRestorePlan(plan: RestorePlan, manifest: BackupManifest) {
  await prisma.$transaction(
    async (transaction) => {
      if (plan.mode === "replace") {
        await transaction.note.deleteMany();
        await transaction.folder.deleteMany();
        await transaction.tag.deleteMany();
        await transaction.setting.deleteMany();
      }

      for (const folder of plan.folderCreates) {
        await transaction.folder.create({
          data: {
            ...folder,
            createdAt: new Date(folder.createdAt),
            updatedAt: new Date(folder.updatedAt),
          },
        });
      }
      if (plan.tagCreates.length) {
        await transaction.tag.createMany({
          data: plan.tagCreates.map((tag) => ({
            ...tag,
            createdAt: new Date(tag.createdAt),
            updatedAt: new Date(tag.updatedAt),
          })),
        });
      }
      if (plan.noteCreates.length) {
        await transaction.note.createMany({
          data: plan.noteCreates.map((note) => ({
            id: note.id,
            title: note.title,
            content: note.content as Prisma.InputJsonValue,
            contentText: note.contentText,
            contentHtml: note.contentHtml,
            contentSchema: note.contentSchema,
            optimisticVersion: note.optimisticVersion,
            folderId: note.folderId,
            pinnedAt: note.pinnedAt ? new Date(note.pinnedAt) : null,
            archivedAt: note.archivedAt ? new Date(note.archivedAt) : null,
            trashedAt: note.trashedAt ? new Date(note.trashedAt) : null,
            createdAt: new Date(note.createdAt),
            updatedAt: new Date(note.updatedAt),
          })),
        });
      }
      if (plan.noteTagCreates.length) {
        await transaction.noteTag.createMany({ data: plan.noteTagCreates });
      }
      if (plan.noteLinkCreates.length) {
        await transaction.noteLink.createMany({
          data: plan.noteLinkCreates.map((link) => ({
            ...link,
            createdAt: new Date(link.createdAt),
            updatedAt: new Date(link.updatedAt),
          })),
        });
      }
      if (plan.attachmentCreates.length) {
        await transaction.attachment.createMany({
          data: plan.attachmentCreates.map((attachment) => ({
            id: attachment.id,
            noteId: attachment.noteId,
            originalName: attachment.originalName,
            storageName: attachment.storageName,
            mimeType: attachment.mimeType,
            byteSize: BigInt(attachment.byteSize),
            checksumSha256: attachment.checksumSha256,
            width: attachment.width,
            height: attachment.height,
            createdAt: new Date(attachment.createdAt),
          })),
        });
      }
      if (plan.settingCreates.length) {
        await transaction.setting.createMany({
          data: plan.settingCreates.map((setting) => ({
            ...setting,
            type: setting.type as SettingType,
            value: setting.value as Prisma.InputJsonValue,
            updatedAt: new Date(setting.updatedAt),
          })),
        });
      }
      if (plan.mode === "replace") {
        await transaction.schemaMetadata.upsert({
          where: { id: 1 },
          create: {
            ...manifest.entities.schemaMetadata,
            updatedAt: new Date(manifest.entities.schemaMetadata.updatedAt),
          },
          update: {
            dataSchemaVersion: manifest.dataSchemaVersion,
            backupSchemaVersion: manifest.backupSchemaVersion,
            updatedAt: new Date(manifest.entities.schemaMetadata.updatedAt),
          },
        });
      }
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 120_000,
    },
  );
}
