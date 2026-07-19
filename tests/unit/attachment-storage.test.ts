import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  contentDisposition,
  createStoredFile,
  imageDimensions,
  listStoredFileNames,
  sanitizeDisplayFilename,
  sniffMimeType,
} from "@/server/attachments/attachment-storage";

let attachmentDirectory: string;

beforeAll(async () => {
  attachmentDirectory = await mkdtemp(
    path.join(tmpdir(), "linked-notes-attachment-unit-"),
  );
});

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://unit/test";
  process.env.ATTACHMENTS_DIR = attachmentDirectory;
  process.env.MAX_UPLOAD_BYTES = "32";
});

afterAll(async () => {
  await rm(attachmentDirectory, { recursive: true, force: true });
});

describe("attachment storage", () => {
  it("sanitizes traversal and header-control characters without using paths", () => {
    expect(sanitizeDisplayFilename(" ../../secret\r\nfile.json ")).toBe(
      ".._.._secretfile.json",
    );
    expect(sanitizeDisplayFilename("../..")).toBe(".._..");
    expect(sanitizeDisplayFilename("\u0000/\\")).toBe("__");

    const header = contentDisposition('résumé"\r\n.pdf', "attachment");
    expect(header).toContain("attachment;");
    expect(header).toContain("filename*=UTF-8''");
    expect(header).not.toContain("\r");
    expect(header).not.toContain("\n");
  });

  it("derives safe MIME types from signatures instead of trusting declarations", () => {
    expect(sniffMimeType(Buffer.from("%PDF-1.7\n"), "image/png")).toBe(
      "application/pdf",
    );
    expect(
      sniffMimeType(Buffer.from("<svg onload=alert(1) />"), "image/svg+xml"),
    ).toBe("application/octet-stream");
    expect(
      sniffMimeType(Buffer.from('{"local":true}'), "application/json"),
    ).toBe("application/json");
    expect(sniffMimeType(Buffer.from([0, 1, 2, 3]), "text/plain")).toBe(
      "application/octet-stream",
    );
    expect(
      sniffMimeType(Buffer.from("47494638396100000000", "hex"), null),
    ).toBe("image/gif");
    expect(
      sniffMimeType(
        Buffer.concat([
          Buffer.from("RIFF"),
          Buffer.alloc(4),
          Buffer.from("WEBPVP8X"),
          Buffer.alloc(14),
        ]),
        null,
      ),
    ).toBe("image/webp");
  });

  it("reads bounded PNG and GIF dimensions", () => {
    const png = Buffer.alloc(24);
    Buffer.from("89504e470d0a1a0a", "hex").copy(png);
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    expect(imageDimensions(png, "image/png")).toEqual({
      width: 640,
      height: 480,
    });

    const gif = Buffer.alloc(10);
    gif.write("GIF89a", "ascii");
    gif.writeUInt16LE(320, 6);
    gif.writeUInt16LE(200, 8);
    expect(imageDimensions(gif, "image/gif")).toEqual({
      width: 320,
      height: 200,
    });
  });

  it("streams bytes once, computes SHA-256, and enforces the configured limit", async () => {
    const bytes = Buffer.from("streamed attachment bytes");
    const stored = await createStoredFile(chunks(bytes, 5), {
      contentLength: bytes.length,
      declaredMimeType: "text/plain",
    });
    expect(stored).toMatchObject({
      byteSize: bytes.length,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      mimeType: "text/plain",
    });
    expect(await listStoredFileNames()).toContain(stored.storageName);

    await expect(
      createStoredFile(chunks(Buffer.alloc(33), 4), {
        contentLength: null,
        declaredMimeType: "application/octet-stream",
      }),
    ).rejects.toMatchObject({ code: "ATTACHMENT_TOO_LARGE", status: 413 });
    expect(await listStoredFileNames()).toEqual([stored.storageName]);
  });

  it("removes staged bytes when an upload ends before its declared length", async () => {
    await expect(
      createStoredFile(chunks(Buffer.from("short"), 2), {
        contentLength: 12,
        declaredMimeType: "text/plain",
      }),
    ).rejects.toMatchObject({ code: "ATTACHMENT_INCOMPLETE", status: 400 });
  });
});

async function* chunks(value: Buffer, size: number) {
  for (let offset = 0; offset < value.length; offset += size) {
    yield value.subarray(offset, offset + size);
  }
}
