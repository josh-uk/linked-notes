import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  createReadStream,
  type Dirent,
  type ReadStream,
} from "node:fs";
import {
  access,
  type FileHandle,
  mkdir,
  lstat,
  open,
  opendir,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import { readServerEnvironment } from "@/lib/env";

import { NoteDomainError } from "@/server/notes/note-errors";

const STORAGE_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREFIX_LIMIT = 256 * 1024;
const SAFE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export type StoredFile = {
  storageName: string;
  byteSize: number;
  checksumSha256: string;
  mimeType: string;
  width: number | null;
  height: number | null;
};

export type StoredFileState =
  | { available: true; byteSize: number }
  | { available: false; reason: "missing" | "size-mismatch" };

export async function createStoredFile(
  source: AsyncIterable<Uint8Array>,
  options: { contentLength: number | null; declaredMimeType: string | null },
): Promise<StoredFile> {
  const environment = readServerEnvironment();
  if (
    options.contentLength !== null &&
    options.contentLength > environment.MAX_UPLOAD_BYTES
  ) {
    throw tooLarge(environment.MAX_UPLOAD_BYTES);
  }

  const root = path.resolve(environment.ATTACHMENTS_DIR);
  const stagingDirectory = path.join(root, ".staging");
  await mkdir(stagingDirectory, { recursive: true, mode: 0o700 });
  const storageName = randomUUID();
  const stagedPath = path.join(stagingDirectory, `${storageName}.part`);
  const finalPath = storedPath(root, storageName);
  const hash = createHash("sha256");
  const prefixChunks: Buffer[] = [];
  let prefixBytes = 0;
  let byteSize = 0;
  const handle = await open(stagedPath, "wx", 0o600);

  try {
    for await (const value of source) {
      const chunk = Buffer.isBuffer(value)
        ? value
        : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      if (chunk.byteLength === 0) continue;
      byteSize += chunk.byteLength;
      if (byteSize > environment.MAX_UPLOAD_BYTES) {
        throw tooLarge(environment.MAX_UPLOAD_BYTES);
      }
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
    if (byteSize === 0) {
      throw new NoteDomainError(
        "ATTACHMENT_EMPTY",
        "The attachment was empty",
        400,
      );
    }
    if (options.contentLength !== null && options.contentLength !== byteSize) {
      throw new NoteDomainError(
        "ATTACHMENT_INCOMPLETE",
        "The upload ended before all declared bytes arrived",
        400,
      );
    }
    await handle.sync();
    await handle.close();

    const prefix = Buffer.concat(prefixChunks, prefixBytes);
    const mimeType = sniffMimeType(prefix, options.declaredMimeType);
    const dimensions = imageDimensions(prefix, mimeType);
    await rename(stagedPath, finalPath);
    return {
      storageName,
      byteSize,
      checksumSha256: hash.digest("hex"),
      mimeType,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(stagedPath).catch(() => undefined);
    throw error;
  }
}

async function writeAll(handle: FileHandle, chunk: Buffer) {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(
      chunk,
      offset,
      chunk.byteLength - offset,
    );
    if (bytesWritten === 0) {
      throw new Error("Attachment storage stopped accepting bytes");
    }
    offset += bytesWritten;
  }
}

export async function storedFileState(
  storageName: string,
  expectedSize: number,
): Promise<StoredFileState> {
  try {
    const file = await lstat(storagePath(storageName));
    if (!file.isFile()) return { available: false, reason: "missing" };
    if (file.size !== expectedSize) {
      return { available: false, reason: "size-mismatch" };
    }
    return { available: true, byteSize: file.size };
  } catch (error) {
    if (isMissing(error)) return { available: false, reason: "missing" };
    throw error;
  }
}

export async function openStoredFile(
  storageName: string,
  expectedSize: number,
): Promise<ReadStream> {
  const state = await storedFileState(storageName, expectedSize);
  if (!state.available) {
    throw new NoteDomainError(
      "ATTACHMENT_BYTES_MISSING",
      state.reason === "missing"
        ? "The attachment bytes are missing from local storage"
        : "The attachment bytes do not match their recorded size",
      410,
    );
  }
  return createReadStream(storagePath(storageName), { flags: "r" });
}

export async function deleteStoredFiles(storageNames: string[]) {
  const result = { deleted: 0, missing: 0, failed: 0 };
  for (const storageName of new Set(storageNames)) {
    try {
      await unlink(storagePath(storageName));
      result.deleted += 1;
    } catch (error) {
      if (isMissing(error)) {
        result.missing += 1;
        continue;
      }
      result.failed += 1;
      console.warn("attachment_orphan_cleanup_failed", {
        storageName,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
  return result;
}

export async function listStoredFileNames(): Promise<string[]> {
  const root = storageRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await opendir(root);
  const names: string[] = [];
  for await (const entry of directory) {
    if (isStoredFileEntry(entry)) names.push(entry.name);
  }
  return names.sort();
}

export async function listStaleStagingFiles(
  olderThan: Date,
): Promise<string[]> {
  const directoryPath = path.join(storageRoot(), ".staging");
  try {
    const directory = await opendir(directoryPath);
    const names: string[] = [];
    for await (const entry of directory) {
      if (!entry.isFile() || !entry.name.endsWith(".part")) continue;
      const file = await stat(path.join(directoryPath, entry.name));
      if (file.mtime <= olderThan) names.push(entry.name);
    }
    return names.sort();
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

export async function deleteStagingFiles(names: string[]) {
  const directory = path.join(storageRoot(), ".staging");
  let deleted = 0;
  for (const name of names) {
    if (!/^[0-9a-f-]{36}\.part$/i.test(name)) continue;
    try {
      await unlink(path.join(directory, name));
      deleted += 1;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  return deleted;
}

export async function checksumStoredFile(storageName: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(storagePath(storageName))) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export function isSafePreviewMimeType(mimeType: string) {
  return SAFE_IMAGE_TYPES.has(mimeType);
}

export function sanitizeDisplayFilename(value: string): string {
  const sanitized = value
    .normalize("NFKC")
    .replaceAll(/[\u0000-\u001f\u007f]/g, "")
    .replaceAll(/[\\/]/g, "_")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  return sanitized && sanitized !== "." && sanitized !== ".."
    ? sanitized
    : "attachment";
}

export function contentDisposition(
  filename: string,
  disposition: "attachment" | "inline",
) {
  const safeName = sanitizeDisplayFilename(filename);
  const fallback = safeName
    .replaceAll(/[^\x20-\x7e]/g, "_")
    .replaceAll(/["\\]/g, "_");
  const encoded = encodeURIComponent(safeName).replaceAll("'", "%27");
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function sniffMimeType(prefix: Buffer, declaredMimeType: string | null) {
  if (prefix.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return "image/png";
  }
  if (prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) {
    return "image/jpeg";
  }
  const signature6 = prefix.subarray(0, 6).toString("ascii");
  if (signature6 === "GIF87a" || signature6 === "GIF89a") {
    return "image/gif";
  }
  if (
    prefix.subarray(0, 4).toString("ascii") === "RIFF" &&
    prefix.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (prefix.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  if (prefix.subarray(0, 4).equals(Buffer.from("504b0304", "hex"))) {
    const sample = prefix.toString("latin1");
    if (sample.includes("[Content_Types].xml") && sample.includes("word/")) {
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }
    return "application/zip";
  }

  const declared = declaredMimeType?.split(";", 1)[0]?.trim().toLowerCase();
  const trimmed = prefix.toString("utf8").trimStart();
  if (
    declared === "application/json" &&
    (trimmed.startsWith("{") || trimmed.startsWith("["))
  ) {
    return "application/json";
  }
  if (declared === "text/plain" && isProbablyText(prefix)) {
    return "text/plain";
  }
  return "application/octet-stream";
}

export function imageDimensions(prefix: Buffer, mimeType: string) {
  if (mimeType === "image/png" && prefix.length >= 24) {
    return dimensions(prefix.readUInt32BE(16), prefix.readUInt32BE(20));
  }
  if (mimeType === "image/gif" && prefix.length >= 10) {
    return dimensions(prefix.readUInt16LE(6), prefix.readUInt16LE(8));
  }
  if (mimeType === "image/webp" && prefix.length >= 30) {
    const kind = prefix.subarray(12, 16).toString("ascii");
    if (kind === "VP8X") {
      return dimensions(
        1 + prefix.readUIntLE(24, 3),
        1 + prefix.readUIntLE(27, 3),
      );
    }
    if (kind === "VP8L" && prefix[20] === 0x2f && prefix.length >= 25) {
      const bits = prefix.readUInt32LE(21);
      return dimensions(1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff));
    }
    if (kind === "VP8 " && prefix.length >= 30) {
      const marker = prefix.indexOf(Buffer.from("9d012a", "hex"), 20);
      if (marker >= 0 && prefix.length >= marker + 7) {
        return dimensions(
          prefix.readUInt16LE(marker + 3) & 0x3fff,
          prefix.readUInt16LE(marker + 5) & 0x3fff,
        );
      }
    }
  }
  if (mimeType === "image/jpeg") return jpegDimensions(prefix);
  return null;
}

function jpegDimensions(prefix: Buffer) {
  let offset = 2;
  while (offset + 8 < prefix.length) {
    if (prefix[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = prefix[offset + 1]!;
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) break;
    if (offset + 2 > prefix.length) break;
    const length = prefix.readUInt16BE(offset);
    if (length < 2 || offset + length > prefix.length) break;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return dimensions(
        prefix.readUInt16BE(offset + 5),
        prefix.readUInt16BE(offset + 3),
      );
    }
    offset += length;
  }
  return null;
}

function dimensions(width: number, height: number) {
  return width > 0 && height > 0 ? { width, height } : null;
}

function isProbablyText(prefix: Buffer) {
  for (const byte of prefix) {
    if (byte === 0) return false;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) return false;
  }
  return true;
}

function storageRoot() {
  return path.resolve(readServerEnvironment().ATTACHMENTS_DIR);
}

function storagePath(storageName: string) {
  return storedPath(storageRoot(), storageName);
}

function storedPath(root: string, storageName: string) {
  if (!STORAGE_NAME_PATTERN.test(storageName)) {
    throw new NoteDomainError(
      "ATTACHMENT_STORAGE_INVALID",
      "Attachment storage metadata was invalid",
      500,
    );
  }
  return path.join(root, storageName);
}

function isStoredFileEntry(entry: Dirent) {
  return entry.isFile() && STORAGE_NAME_PATTERN.test(entry.name);
}

function isMissing(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function tooLarge(maximum: number) {
  return new NoteDomainError(
    "ATTACHMENT_TOO_LARGE",
    `Attachments may be at most ${maximum} bytes`,
    413,
  );
}

export async function ensureAttachmentDirectoryWritable() {
  const root = storageRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  await access(root, constants.W_OK);
}
