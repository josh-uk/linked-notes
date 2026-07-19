import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, opendir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { createGzip } from "node:zlib";

import { Prisma } from "@prisma/client";
import * as tar from "tar-stream";

import { readServerEnvironment } from "@/lib/env";
import { prisma } from "@/server/db";
import { openStoredFile } from "@/server/attachments/attachment-storage";
import { NoteDomainError } from "@/server/notes/note-errors";

import {
  APPLICATION_VERSION,
  attachmentArchivePath,
  BACKUP_EXTENSION,
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  type BackupManifest,
  canonicalManifestBytes,
  MANIFEST_CHECKSUM_PATH,
  MANIFEST_PATH,
  parseBackupManifest,
} from "./backup-format";

const ARCHIVE_EPOCH = new Date(0);
const WORK_DIRECTORY = ".backup-work";
const SAFETY_DIRECTORY = ".safety-backups";
const SAFETY_NAME_PATTERN =
  /^safety-\d{8}T\d{6}Z-[0-9a-f-]{36}\.linked-notes-backup\.tar\.gz$/i;

export type GeneratedBackup = {
  filePath: string;
  filename: string;
  byteSize: number;
  checksumSha256: string;
  manifestChecksumSha256: string;
  safety: boolean;
};

export async function generateWorkspaceBackup(options?: {
  safety?: boolean;
  createdAt?: Date;
}): Promise<GeneratedBackup> {
  const safety = options?.safety ?? false;
  const createdAt = options?.createdAt ?? new Date();
  const root = path.resolve(readServerEnvironment().ATTACHMENTS_DIR);
  const workDirectory = path.join(root, WORK_DIRECTORY);
  const safetyDirectory = path.join(root, SAFETY_DIRECTORY);
  await mkdir(workDirectory, { recursive: true, mode: 0o700 });
  if (safety) await mkdir(safetyDirectory, { recursive: true, mode: 0o700 });
  await removeStaleWorkFiles(workDirectory);

  const manifest = await captureWorkspaceManifest(createdAt);
  const manifestBytes = canonicalManifestBytes(manifest);
  const manifestChecksumSha256 = createHash("sha256")
    .update(manifestBytes)
    .digest("hex");
  const workPath = path.join(workDirectory, `${randomUUID()}.part`);

  try {
    await writeArchive(
      workPath,
      manifest,
      manifestBytes,
      manifestChecksumSha256,
    );
    const timestamp = filenameTimestamp(createdAt);
    const filename = safety
      ? `safety-${timestamp}-${randomUUID()}${BACKUP_EXTENSION}`
      : `linked-notes-${timestamp}${BACKUP_EXTENSION}`;
    const filePath = safety ? path.join(safetyDirectory, filename) : workPath;
    if (safety) await rename(workPath, filePath);
    const file = await stat(filePath);
    return {
      filePath,
      filename,
      byteSize: file.size,
      checksumSha256: await checksumFile(filePath),
      manifestChecksumSha256,
      safety,
    };
  } catch (error) {
    await unlink(workPath).catch(() => undefined);
    throw error;
  }
}

export async function removeGeneratedBackup(backup: GeneratedBackup) {
  if (!backup.safety) await unlink(backup.filePath).catch(() => undefined);
}

export async function removeSafetyBackup(backup: GeneratedBackup) {
  if (backup.safety) await unlink(backup.filePath).catch(() => undefined);
}

export function openGeneratedBackup(backup: GeneratedBackup) {
  return createReadStream(backup.filePath, { flags: "r" });
}

export async function listSafetyBackups() {
  const directory = path.join(
    path.resolve(readServerEnvironment().ATTACHMENTS_DIR),
    SAFETY_DIRECTORY,
  );
  try {
    const entries = await opendir(directory);
    const values: Array<{ name: string; byteSize: number; createdAt: string }> =
      [];
    for await (const entry of entries) {
      if (!entry.isFile() || !SAFETY_NAME_PATTERN.test(entry.name)) continue;
      const file = await stat(path.join(directory, entry.name));
      values.push({
        name: entry.name,
        byteSize: file.size,
        createdAt: file.birthtime.toISOString(),
      });
    }
    return values.sort((left, right) => right.name.localeCompare(left.name));
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

export async function openSafetyBackup(name: string) {
  if (!SAFETY_NAME_PATTERN.test(name)) {
    throw new NoteDomainError(
      "SAFETY_BACKUP_NAME_INVALID",
      "The safety backup name was invalid",
      400,
    );
  }
  const filePath = path.join(
    path.resolve(readServerEnvironment().ATTACHMENTS_DIR),
    SAFETY_DIRECTORY,
    name,
  );
  try {
    const file = await stat(filePath);
    if (!file.isFile()) {
      throw new NoteDomainError(
        "SAFETY_BACKUP_NOT_FOUND",
        "The safety backup was not found",
        404,
      );
    }
    return { stream: createReadStream(filePath), byteSize: file.size };
  } catch (error) {
    if (isMissing(error)) {
      throw new NoteDomainError(
        "SAFETY_BACKUP_NOT_FOUND",
        "The safety backup was not found",
        404,
      );
    }
    throw error;
  }
}

export async function captureWorkspaceManifest(createdAt = new Date()) {
  const snapshot = await prisma.$transaction(
    async (transaction) => {
      const [
        schemaMetadata,
        folders,
        tags,
        notes,
        noteTags,
        noteLinks,
        settings,
        attachments,
      ] = await Promise.all([
        transaction.schemaMetadata.findUnique({ where: { id: 1 } }),
        transaction.folder.findMany({ orderBy: { id: "asc" } }),
        transaction.tag.findMany({ orderBy: { id: "asc" } }),
        transaction.note.findMany({ orderBy: { id: "asc" } }),
        transaction.noteTag.findMany({
          orderBy: [{ noteId: "asc" }, { tagId: "asc" }],
        }),
        transaction.noteLink.findMany({
          orderBy: [{ sourceNoteId: "asc" }, { mentionId: "asc" }],
        }),
        transaction.setting.findMany({ orderBy: { key: "asc" } }),
        transaction.attachment.findMany({ orderBy: { id: "asc" } }),
      ]);
      if (!schemaMetadata) {
        throw new NoteDomainError(
          "BACKUP_SCHEMA_METADATA_MISSING",
          "Workspace schema metadata is missing",
          500,
        );
      }
      return {
        schemaMetadata,
        folders,
        tags,
        notes,
        noteTags,
        noteLinks,
        settings,
        attachments,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    backupSchemaVersion: BACKUP_SCHEMA_VERSION,
    dataSchemaVersion: snapshot.schemaMetadata.dataSchemaVersion,
    applicationVersion: APPLICATION_VERSION,
    createdAt: createdAt.toISOString(),
    entities: {
      schemaMetadata: {
        ...snapshot.schemaMetadata,
        id: 1,
        updatedAt: snapshot.schemaMetadata.updatedAt.toISOString(),
      },
      folders: snapshot.folders.map((folder) => ({
        ...folder,
        createdAt: folder.createdAt.toISOString(),
        updatedAt: folder.updatedAt.toISOString(),
      })),
      tags: snapshot.tags.map((tag) => ({
        ...tag,
        createdAt: tag.createdAt.toISOString(),
        updatedAt: tag.updatedAt.toISOString(),
      })),
      notes: snapshot.notes.map((note) => ({
        id: note.id,
        title: note.title,
        content:
          note.content as BackupManifest["entities"]["notes"][number]["content"],
        contentSchema: note.contentSchema,
        optimisticVersion: note.optimisticVersion,
        folderId: note.folderId,
        pinnedAt: note.pinnedAt?.toISOString() ?? null,
        archivedAt: note.archivedAt?.toISOString() ?? null,
        trashedAt: note.trashedAt?.toISOString() ?? null,
        createdAt: note.createdAt.toISOString(),
        updatedAt: note.updatedAt.toISOString(),
      })),
      noteTags: snapshot.noteTags,
      noteLinks: snapshot.noteLinks.map((link) => ({
        ...link,
        createdAt: link.createdAt.toISOString(),
        updatedAt: link.updatedAt.toISOString(),
      })),
      settings: snapshot.settings.map((setting) => ({
        ...setting,
        value:
          setting.value as BackupManifest["entities"]["settings"][number]["value"],
        updatedAt: setting.updatedAt.toISOString(),
      })),
      attachments: snapshot.attachments.map((attachment) => ({
        id: attachment.id,
        noteId: attachment.noteId,
        originalName: attachment.originalName,
        storageName: attachment.storageName,
        archivePath: attachmentArchivePath(attachment.id),
        mimeType: attachment.mimeType,
        byteSize: safeByteSize(attachment.byteSize),
        checksumSha256: attachment.checksumSha256,
        width: attachment.width,
        height: attachment.height,
        createdAt: attachment.createdAt.toISOString(),
      })),
    },
  };
  return parseBackupManifest(manifest);
}

async function writeArchive(
  filePath: string,
  manifest: BackupManifest,
  manifestBytes: Buffer,
  manifestChecksumSha256: string,
) {
  const pack = tar.pack();
  const target = createWriteStream(filePath, { flags: "wx", mode: 0o600 });
  const archive = pipeline(pack, createGzip({ level: 6 }), target);
  try {
    await addBufferEntry(pack, MANIFEST_PATH, manifestBytes);
    await addBufferEntry(
      pack,
      MANIFEST_CHECKSUM_PATH,
      Buffer.from(`${manifestChecksumSha256}  ${MANIFEST_PATH}\n`),
    );
    for (const attachment of manifest.entities.attachments) {
      const entry = pack.entry(
        archiveHeader(attachment.archivePath, attachment.byteSize),
      );
      const hash = createHash("sha256");
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(
        await openStoredFile(attachment.storageName, attachment.byteSize),
        counter,
        entry,
      );
      if (hash.digest("hex") !== attachment.checksumSha256) {
        throw new NoteDomainError(
          "BACKUP_ATTACHMENT_CHECKSUM_INVALID",
          "An attachment failed checksum verification during backup",
          409,
        );
      }
    }
    pack.finalize();
    await archive;
  } catch (error) {
    pack.destroy(error instanceof Error ? error : new Error("Archive failed"));
    target.destroy();
    await archive.catch(() => undefined);
    throw error;
  }
}

function addBufferEntry(pack: tar.Pack, name: string, value: Buffer) {
  return new Promise<void>((resolve, reject) => {
    pack.entry(archiveHeader(name, value.byteLength), value, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function archiveHeader(name: string, size: number): tar.Headers {
  return {
    name,
    size,
    type: "file",
    mode: 0o600,
    uid: 0,
    gid: 0,
    uname: "root",
    gname: "root",
    mtime: ARCHIVE_EPOCH,
  };
}

async function checksumFile(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function removeStaleWorkFiles(directory: string) {
  const threshold = Date.now() - 24 * 60 * 60 * 1_000;
  const entries = await opendir(directory);
  for await (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".part")) continue;
    const filePath = path.join(directory, entry.name);
    const file = await stat(filePath);
    if (file.mtimeMs <= threshold)
      await unlink(filePath).catch(() => undefined);
  }
}

function filenameTimestamp(value: Date) {
  return value
    .toISOString()
    .replaceAll(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function safeByteSize(value: bigint) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new NoteDomainError(
      "BACKUP_ATTACHMENT_SIZE_INVALID",
      "An attachment size cannot be represented safely in a backup",
      500,
    );
  }
  return number;
}

function isMissing(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
