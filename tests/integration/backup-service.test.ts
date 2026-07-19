import { randomUUID } from "node:crypto";
import { createGzip } from "node:zlib";
import { Readable } from "node:stream";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as tar from "tar-stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import {
  getAttachmentDownload,
  uploadAttachment,
} from "@/server/attachments/attachment-service";
import {
  captureWorkspaceManifest,
  generateWorkspaceBackup,
  listSafetyBackups,
  removeGeneratedBackup,
} from "@/server/backups/backup-archive";
import {
  canonicalManifestBytes,
  MANIFEST_CHECKSUM_PATH,
  MANIFEST_PATH,
} from "@/server/backups/backup-format";
import { restoreWorkspaceBackup } from "@/server/backups/backup-restore";
import { listBacklinks } from "@/server/notes/note-links";
import {
  createFolder,
  createTag,
  setTrashRetention,
} from "@/server/notes/organization-service";
import { createNote, getNote, updateNote } from "@/server/notes/note-service";

let attachmentDirectory: string;

describe("backup and restore service", () => {
  beforeAll(async () => {
    attachmentDirectory = await mkdtemp(
      path.join(tmpdir(), "linked-notes-backup-integration-"),
    );
    process.env.ATTACHMENTS_DIR = attachmentDirectory;
    process.env.MAX_UPLOAD_BYTES = "104857600";
    process.env.MAX_BACKUP_ARCHIVE_BYTES = "2147483648";
    process.env.MAX_BACKUP_EXPANDED_BYTES = "4294967296";
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.note.deleteMany();
    await prisma.folder.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.setting.deleteMany();
    await rm(attachmentDirectory, { recursive: true, force: true });
    await mkdir(attachmentDirectory, { recursive: true });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await rm(attachmentDirectory, { recursive: true, force: true });
  });

  it("round-trips the full workspace in replace mode after creating a safety backup", async () => {
    const fixture = await createWorkspaceFixture();
    const backupTime = new Date("2026-07-19T12:00:00.000Z");
    const expectedWorkspace = await captureWorkspaceManifest(backupTime);
    const generated = await generateWorkspaceBackup({
      createdAt: backupTime,
    });
    const archive = await readFile(generated.filePath);
    expect(generated.manifestChecksumSha256).toMatch(/^[0-9a-f]{64}$/);
    await removeGeneratedBackup(generated);

    const extra = await createNote({ title: "Must be replaced" });
    const restored = await restoreWorkspaceBackup(
      chunks(archive, 997),
      { mode: "replace", confirmation: "REPLACE" },
      { contentLength: archive.byteLength },
    );

    expect(restored).toMatchObject({
      restored: true,
      mode: "replace",
      summary: {
        notesCreated: 2,
        attachmentsCreated: 1,
        noteIdsRemapped: 0,
      },
      safetyBackup: { checksumSha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
    });
    expect(
      await prisma.note.findUnique({ where: { id: extra.id } }),
    ).toBeNull();
    expect((await getNote(fixture.sourceId)).title).toBe("Source note");
    expect((await listBacklinks(fixture.targetId)).totalMentions).toBe(1);
    expect(await prisma.folder.count()).toBe(1);
    expect(await prisma.tag.count()).toBe(1);
    expect(await prisma.setting.count()).toBe(1);
    const attachment = await prisma.attachment.findFirstOrThrow({
      where: { noteId: fixture.sourceId },
    });
    expect(
      await collect((await getAttachmentDownload(attachment.id)).stream),
    ).toEqual(fixture.attachmentBytes);
    expect(
      withoutPhysicalStorageNames(await captureWorkspaceManifest(backupTime)),
    ).toEqual(withoutPhysicalStorageNames(expectedWorkspace));
    expect(await listSafetyBackups()).toHaveLength(1);
  });

  it("merge-remaps colliding notes and attachments while preserving internal links", async () => {
    const fixture = await createWorkspaceFixture();
    const generated = await generateWorkspaceBackup();
    const archive = await readFile(generated.filePath);
    await removeGeneratedBackup(generated);

    const restored = await restoreWorkspaceBackup(
      chunks(archive, 257),
      { mode: "merge" },
      { contentLength: archive.byteLength },
    );
    expect(restored.summary).toMatchObject({
      notesCreated: 2,
      noteIdsRemapped: 2,
      attachmentsCreated: 1,
      attachmentIdsRemapped: 1,
      foldersMatched: 1,
      tagsMatched: 1,
    });
    expect(await prisma.note.count()).toBe(4);
    expect(await prisma.attachment.count()).toBe(2);
    expect(await prisma.folder.count()).toBe(1);
    expect(await prisma.tag.count()).toBe(1);
    const clonedSources = await prisma.note.findMany({
      where: { title: "Source note", id: { not: fixture.sourceId } },
    });
    expect(clonedSources).toHaveLength(1);
    const clonedLink = await prisma.noteLink.findFirstOrThrow({
      where: { sourceNoteId: clonedSources[0]!.id },
    });
    expect(clonedLink.targetNoteId).not.toBe(fixture.targetId);
    expect(
      await prisma.note.findUnique({ where: { id: clonedLink.targetNoteId! } }),
    ).toMatchObject({ title: "Target note" });
  });

  it("rejects checksum-invalid and traversal archives before live mutation", async () => {
    await createNote({ title: "Existing remains" });
    const manifest = await captureWorkspaceManifest(
      new Date("2026-07-19T12:00:00.000Z"),
    );
    const manifestBytes = canonicalManifestBytes(manifest);
    const checksumInvalid = await archiveBytes([
      [MANIFEST_PATH, manifestBytes],
      [
        MANIFEST_CHECKSUM_PATH,
        Buffer.from(`${"0".repeat(64)}  manifest.json\n`),
      ],
    ]);
    await expect(
      restoreWorkspaceBackup(
        chunks(checksumInvalid, 31),
        { mode: "merge" },
        { contentLength: checksumInvalid.byteLength },
      ),
    ).rejects.toMatchObject({ code: "BACKUP_MANIFEST_CHECKSUM_INVALID" });
    expect(await prisma.note.count()).toBe(1);

    const traversal = await archiveBytes([
      ["../manifest.json", Buffer.from("unsafe")],
    ]);
    await expect(
      restoreWorkspaceBackup(
        chunks(traversal, 17),
        { mode: "merge" },
        { contentLength: traversal.byteLength },
      ),
    ).rejects.toMatchObject({ code: "BACKUP_PATH_UNSAFE" });
    expect(await prisma.note.count()).toBe(1);
  });

  it("rejects declared oversized and corrupt archives without mutation", async () => {
    await createNote({ title: "Existing remains" });
    process.env.MAX_BACKUP_ARCHIVE_BYTES = "8";
    await expect(
      restoreWorkspaceBackup(
        chunks(Buffer.from("not gzip"), 2),
        { mode: "merge" },
        { contentLength: 9 },
      ),
    ).rejects.toMatchObject({ code: "BACKUP_ARCHIVE_TOO_LARGE" });
    process.env.MAX_BACKUP_ARCHIVE_BYTES = "2147483648";
    await expect(
      restoreWorkspaceBackup(
        chunks(Buffer.from("not gzip"), 2),
        { mode: "merge" },
        { contentLength: 8 },
      ),
    ).rejects.toMatchObject({ code: "BACKUP_ARCHIVE_INVALID" });
    expect(await prisma.note.count()).toBe(1);
  });

  it("rejects incomplete, entry-flood, and excessive-expansion uploads without mutation", async () => {
    await createNote({ title: "Existing remains" });
    const generated = await generateWorkspaceBackup();
    const validArchive = await readFile(generated.filePath);
    await removeGeneratedBackup(generated);

    await expect(
      restoreWorkspaceBackup(
        chunks(validArchive, 71),
        { mode: "merge" },
        { contentLength: validArchive.byteLength + 1 },
      ),
    ).rejects.toMatchObject({ code: "BACKUP_UPLOAD_INCOMPLETE" });

    try {
      process.env.MAX_BACKUP_ENTRIES = "2";
      const entryFlood = await archiveBytes([
        [MANIFEST_PATH, Buffer.from("{}")],
        [MANIFEST_CHECKSUM_PATH, Buffer.from("invalid")],
        ["attachments/11111111-1111-4111-8111-111111111111", Buffer.from("3")],
      ]);
      await expect(
        restoreWorkspaceBackup(
          chunks(entryFlood, 23),
          { mode: "merge" },
          { contentLength: entryFlood.byteLength },
        ),
      ).rejects.toMatchObject({ code: "BACKUP_ENTRY_LIMIT_EXCEEDED" });

      process.env.MAX_BACKUP_ENTRIES = "50000";
      process.env.MAX_BACKUP_COMPRESSION_RATIO = "1";
      const expansionBomb = await archiveBytes([
        [MANIFEST_PATH, Buffer.alloc(2 * 1_024 * 1_024)],
      ]);
      await expect(
        restoreWorkspaceBackup(
          chunks(expansionBomb, 43),
          { mode: "merge" },
          { contentLength: expansionBomb.byteLength },
        ),
      ).rejects.toMatchObject({ code: "BACKUP_COMPRESSION_RATIO_EXCEEDED" });
    } finally {
      process.env.MAX_BACKUP_ENTRIES = "50000";
      process.env.MAX_BACKUP_COMPRESSION_RATIO = "5000";
    }

    expect(await prisma.note.count()).toBe(1);
  });
});

async function createWorkspaceFixture() {
  const folder = await createFolder({ name: "Projects", parentId: null });
  const tag = await createTag({ name: "Portable", color: "#7a5c44" });
  const target = await createNote({ title: "Target note" });
  let source = await createNote({
    title: "Source note",
    folderId: folder.id,
    tagIds: [tag.id],
  });
  source = await updateNote(source.id, {
    expectedVersion: source.optimisticVersion,
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "See " },
            {
              type: "mention",
              attrs: {
                id: target.id,
                mentionId: randomUUID(),
                label: "Target note",
              },
            },
          ],
        },
      ],
    },
  });
  const attachmentBytes = Buffer.from('{"portable":true}');
  await uploadAttachment(
    source.id,
    {
      filename: "portable.json",
      expectedVersion: source.optimisticVersion,
      contentLength: attachmentBytes.byteLength,
      declaredMimeType: "application/json",
    },
    chunks(attachmentBytes, 3),
  );
  await setTrashRetention({ days: 90 });
  return {
    sourceId: source.id,
    targetId: target.id,
    attachmentBytes,
  };
}

async function archiveBytes(entries: Array<[string, Buffer]>) {
  const pack = tar.pack();
  for (const [name, bytes] of entries) {
    pack.entry(
      {
        name,
        size: bytes.byteLength,
        type: "file",
        mode: 0o600,
        mtime: new Date(0),
      },
      bytes,
    );
  }
  pack.finalize();
  return collect(pack.pipe(createGzip({ level: 6 })));
}

async function* chunks(value: Buffer, size: number) {
  for (let index = 0; index < value.length; index += size) {
    yield value.subarray(index, Math.min(value.length, index + size));
  }
}

async function collect(source: Readable) {
  const values: Buffer[] = [];
  for await (const value of source) {
    values.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
  }
  return Buffer.concat(values);
}

function withoutPhysicalStorageNames<
  T extends { entities: { attachments: Array<{ storageName: string }> } },
>(manifest: T) {
  return {
    ...manifest,
    entities: {
      ...manifest.entities,
      attachments: manifest.entities.attachments.map((attachment) => ({
        ...attachment,
        storageName: "<opaque>",
      })),
    },
  };
}
