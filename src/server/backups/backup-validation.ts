import { createHash, randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { type FileHandle, mkdir, open, rm } from "node:fs/promises";
import path from "node:path";

import * as tar from "tar-stream";

import { readServerEnvironment } from "@/lib/env";
import { prisma } from "@/server/db";
import {
  imageDimensions,
  sniffMimeType,
} from "@/server/attachments/attachment-storage";
import { NoteDomainError } from "@/server/notes/note-errors";

import {
  assertSafeArchivePath,
  attachmentArchivePath,
  BACKUP_SCHEMA_VERSION,
  type BackupManifest,
  MANIFEST_CHECKSUM_PATH,
  MANIFEST_PATH,
  parseBackupManifest,
} from "./backup-format";

const PREFIX_LIMIT = 256 * 1_024;
const RESTORE_DIRECTORY = ".restore-staging";
const CHECKSUM_FILE_LIMIT = 512;

export type StagedAttachmentFile = {
  attachmentId: string;
  archivePath: string;
  filePath: string;
  byteSize: number;
  checksumSha256: string;
  prefix: Buffer;
};

export type StagedBackup = {
  stagingRoot: string;
  manifest: BackupManifest;
  attachments: Map<string, StagedAttachmentFile>;
  compressedBytes: number;
  expandedBytes: number;
  entryCount: number;
};

export async function stageAndValidateBackup(
  source: AsyncIterable<Uint8Array>,
  options: { contentLength: number | null },
): Promise<StagedBackup> {
  const environment = readServerEnvironment();
  if (
    options.contentLength !== null &&
    options.contentLength > environment.MAX_BACKUP_ARCHIVE_BYTES
  ) {
    throw archiveTooLarge();
  }

  const storageRoot = path.resolve(environment.ATTACHMENTS_DIR);
  const stagingRoot = path.join(storageRoot, RESTORE_DIRECTORY, randomUUID());
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 });

  let compressedBytes = 0;
  let expandedBytes = 0;
  let entryCount = 0;
  const seenPaths = new Set<string>();
  const attachments = new Map<string, StagedAttachmentFile>();
  let manifestBytes: Buffer | null = null;
  let manifestChecksumBytes: Buffer | null = null;
  const compressedCounter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      compressedBytes += chunk.byteLength;
      if (compressedBytes > environment.MAX_BACKUP_ARCHIVE_BYTES) {
        callback(archiveTooLarge());
        return;
      }
      callback(null, chunk);
    },
  });
  const expandedCounter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      expandedBytes += chunk.byteLength;
      if (expandedBytes > environment.MAX_BACKUP_EXPANDED_BYTES) {
        callback(expandedTooLarge());
        return;
      }
      const allowedByRatio =
        Math.max(compressedBytes, 1_024) *
          environment.MAX_BACKUP_COMPRESSION_RATIO +
        1_048_576;
      if (expandedBytes > allowedByRatio) {
        callback(
          new NoteDomainError(
            "BACKUP_COMPRESSION_RATIO_EXCEEDED",
            "The backup expanded beyond the allowed compression ratio",
            413,
          ),
        );
        return;
      }
      callback(null, chunk);
    },
  });
  const extract = tar.extract({ allowUnknownFormat: false });
  const extraction = pipeline(
    Readable.from(source),
    compressedCounter,
    createGunzip(),
    expandedCounter,
    extract,
  );

  try {
    for await (const entry of extract) {
      entryCount += 1;
      if (entryCount > environment.MAX_BACKUP_ENTRIES) {
        throw new NoteDomainError(
          "BACKUP_ENTRY_LIMIT_EXCEEDED",
          "The backup contained too many archive entries",
          413,
        );
      }
      const name = assertSafeArchivePath(entry.header.name);
      if (seenPaths.has(name)) {
        throw new NoteDomainError(
          "BACKUP_ENTRY_DUPLICATE",
          "The backup contained a duplicate archive entry",
          400,
        );
      }
      seenPaths.add(name);
      if (entry.header.type !== "file") {
        throw new NoteDomainError(
          "BACKUP_ENTRY_TYPE_UNSAFE",
          "The backup contained a non-file archive entry",
          400,
        );
      }
      const size = entry.header.size;
      if (!Number.isSafeInteger(size) || size === undefined || size < 0) {
        throw invalidArchive();
      }

      if (name === MANIFEST_PATH) {
        if (size > environment.MAX_BACKUP_MANIFEST_BYTES) {
          throw new NoteDomainError(
            "BACKUP_MANIFEST_TOO_LARGE",
            "The backup manifest exceeded the configured limit",
            413,
          );
        }
        manifestBytes = await collectEntry(entry, size);
        continue;
      }
      if (name === MANIFEST_CHECKSUM_PATH) {
        if (size > CHECKSUM_FILE_LIMIT) throw invalidArchive();
        manifestChecksumBytes = await collectEntry(entry, size);
        continue;
      }

      const match = /^attachments\/([0-9a-f-]{36})$/i.exec(name);
      if (!match) {
        throw new NoteDomainError(
          "BACKUP_ENTRY_UNEXPECTED",
          "The backup contained an unexpected archive entry",
          400,
        );
      }
      const attachmentId = match[1]!;
      if (attachmentArchivePath(attachmentId) !== name) throw invalidArchive();
      if (size <= 0 || size > environment.MAX_UPLOAD_BYTES) {
        throw new NoteDomainError(
          "BACKUP_ATTACHMENT_SIZE_INVALID",
          "A backup attachment exceeded the configured file limit",
          413,
        );
      }
      const filePath = path.join(stagingRoot, `${attachmentId}.file`);
      attachments.set(
        attachmentId,
        await stageAttachmentEntry(entry, {
          attachmentId,
          archivePath: name,
          filePath,
          expectedSize: size,
        }),
      );
    }
    await extraction;
    if (
      options.contentLength !== null &&
      options.contentLength !== compressedBytes
    ) {
      throw new NoteDomainError(
        "BACKUP_UPLOAD_INCOMPLETE",
        "The backup upload ended before all declared bytes arrived",
        400,
      );
    }
    if (!manifestBytes || !manifestChecksumBytes) throw invalidArchive();
    const expectedManifestChecksum = parseManifestChecksum(
      manifestChecksumBytes,
    );
    const actualManifestChecksum = createHash("sha256")
      .update(manifestBytes)
      .digest("hex");
    if (expectedManifestChecksum !== actualManifestChecksum) {
      throw new NoteDomainError(
        "BACKUP_MANIFEST_CHECKSUM_INVALID",
        "The backup manifest checksum did not match",
        400,
      );
    }

    let manifestValue: unknown;
    try {
      manifestValue = JSON.parse(manifestBytes.toString("utf8"));
    } catch {
      throw invalidArchive();
    }
    let manifest: BackupManifest;
    try {
      manifest = parseBackupManifest(manifestValue);
    } catch {
      throw new NoteDomainError(
        "BACKUP_MANIFEST_INVALID",
        "The backup manifest failed structural validation",
        400,
      );
    }
    await assertCompatibleVersions(manifest);
    validateStagedAttachments(manifest, attachments);

    return {
      stagingRoot,
      manifest,
      attachments,
      compressedBytes,
      expandedBytes,
      entryCount,
    };
  } catch (error) {
    extract.destroy(
      error instanceof Error ? error : new Error("Restore failed"),
    );
    await extraction.catch(() => undefined);
    await rm(stagingRoot, { recursive: true, force: true });
    if (error instanceof NoteDomainError) throw error;
    console.warn("backup_validation_failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    throw invalidArchive();
  }
}

export async function removeStagedBackup(staged: StagedBackup) {
  await rm(staged.stagingRoot, { recursive: true, force: true });
}

async function stageAttachmentEntry(
  entry: tar.Entry,
  input: {
    attachmentId: string;
    archivePath: string;
    filePath: string;
    expectedSize: number;
  },
): Promise<StagedAttachmentFile> {
  const handle = await open(input.filePath, "wx", 0o600);
  const hash = createHash("sha256");
  const prefixChunks: Buffer[] = [];
  let prefixBytes = 0;
  let byteSize = 0;
  try {
    for await (const value of entry) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      byteSize += chunk.byteLength;
      if (byteSize > input.expectedSize) throw invalidArchive();
      hash.update(chunk);
      if (prefixBytes < PREFIX_LIMIT) {
        const captured = chunk.subarray(
          0,
          Math.min(chunk.byteLength, PREFIX_LIMIT - prefixBytes),
        );
        prefixChunks.push(Buffer.from(captured));
        prefixBytes += captured.byteLength;
      }
      await writeAll(handle, chunk);
    }
    if (byteSize !== input.expectedSize) throw invalidArchive();
    await handle.sync();
    await handle.close();
    return {
      attachmentId: input.attachmentId,
      archivePath: input.archivePath,
      filePath: input.filePath,
      byteSize,
      checksumSha256: hash.digest("hex"),
      prefix: Buffer.concat(prefixChunks, prefixBytes),
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function collectEntry(entry: tar.Entry, expectedSize: number) {
  const chunks: Buffer[] = [];
  let byteSize = 0;
  for await (const value of entry) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    byteSize += chunk.byteLength;
    if (byteSize > expectedSize) throw invalidArchive();
    chunks.push(chunk);
  }
  if (byteSize !== expectedSize) throw invalidArchive();
  return Buffer.concat(chunks, byteSize);
}

async function writeAll(handle: FileHandle, chunk: Buffer) {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(
      chunk,
      offset,
      chunk.byteLength - offset,
    );
    if (bytesWritten === 0) throw invalidArchive();
    offset += bytesWritten;
  }
}

function parseManifestChecksum(value: Buffer) {
  const match = new RegExp(`^([0-9a-f]{64})  ${MANIFEST_PATH}\\n?$`).exec(
    value.toString("ascii"),
  );
  if (!match) throw invalidArchive();
  return match[1]!;
}

async function assertCompatibleVersions(manifest: BackupManifest) {
  if (manifest.backupSchemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new NoteDomainError(
      "BACKUP_VERSION_UNSUPPORTED",
      "The backup format version is not supported",
      409,
    );
  }
  const current = await prisma.schemaMetadata.findUnique({ where: { id: 1 } });
  if (!current || manifest.dataSchemaVersion !== current.dataSchemaVersion) {
    throw new NoteDomainError(
      "BACKUP_DATA_VERSION_UNSUPPORTED",
      "The backup data schema is not compatible with this installation",
      409,
    );
  }
}

function validateStagedAttachments(
  manifest: BackupManifest,
  attachments: Map<string, StagedAttachmentFile>,
) {
  if (attachments.size !== manifest.entities.attachments.length) {
    throw new NoteDomainError(
      "BACKUP_ATTACHMENT_SET_INVALID",
      "The backup attachment entries did not match the manifest",
      400,
    );
  }
  for (const attachment of manifest.entities.attachments) {
    const staged = attachments.get(attachment.id);
    if (
      !staged ||
      staged.archivePath !== attachment.archivePath ||
      staged.byteSize !== attachment.byteSize ||
      staged.checksumSha256 !== attachment.checksumSha256
    ) {
      throw new NoteDomainError(
        "BACKUP_ATTACHMENT_CHECKSUM_INVALID",
        "A backup attachment failed size or checksum verification",
        400,
      );
    }
    const detectedMime = sniffMimeType(staged.prefix, attachment.mimeType);
    const detectedDimensions = imageDimensions(staged.prefix, detectedMime);
    if (
      detectedMime !== attachment.mimeType ||
      (detectedDimensions?.width ?? null) !== attachment.width ||
      (detectedDimensions?.height ?? null) !== attachment.height
    ) {
      throw new NoteDomainError(
        "BACKUP_ATTACHMENT_METADATA_INVALID",
        "A backup attachment did not match its safe metadata",
        400,
      );
    }
  }
}

function archiveTooLarge() {
  return new NoteDomainError(
    "BACKUP_ARCHIVE_TOO_LARGE",
    "The backup archive exceeded the configured upload limit",
    413,
  );
}

function expandedTooLarge() {
  return new NoteDomainError(
    "BACKUP_EXPANDED_TOO_LARGE",
    "The expanded backup exceeded the configured limit",
    413,
  );
}

function invalidArchive() {
  return new NoteDomainError(
    "BACKUP_ARCHIVE_INVALID",
    "The selected file is not a valid Linked Notes backup",
    400,
  );
}
