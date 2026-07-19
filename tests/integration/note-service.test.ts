import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { EMPTY_EDITOR_DOCUMENT } from "@/features/notes/document-schema";
import { prisma } from "@/server/db";
import {
  deleteAttachment,
  getAttachmentDownload,
  listNoteAttachments,
  reconcileAttachments,
  uploadAttachment,
} from "@/server/attachments/attachment-service";
import { listStoredFileNames } from "@/server/attachments/attachment-storage";
import { NoteDomainError } from "@/server/notes/note-errors";
import {
  listBacklinks,
  listBacklinksPage,
  searchMentionSuggestions,
} from "@/server/notes/note-links";
import {
  createFolder,
  createTag,
  deleteFolder,
  getOrganization,
  setTrashRetention,
  updateFolder,
  updateTag,
} from "@/server/notes/organization-service";
import {
  applyNoteLifecycle,
  applyBulkNoteAction,
  createNote,
  deleteNotePermanently,
  getNote,
  listNotes,
  updateNote,
} from "@/server/notes/note-service";
import { searchNotes } from "@/server/notes/search-service";

const richDocument = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "A durable " },
        { type: "text", text: "thought", marks: [{ type: "bold" }] },
      ],
    },
  ],
};

let attachmentDirectory: string;

function linkedDocument(
  targetId: string,
  mentionId = crypto.randomUUID(),
  label = "Original target title",
) {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Context before " },
          {
            type: "mention",
            attrs: { id: targetId, mentionId, label },
          },
          { type: "text", text: " and context after." },
        ],
      },
    ],
  };
}

describe("note service", () => {
  beforeAll(async () => {
    attachmentDirectory = await mkdtemp(
      path.join(tmpdir(), "linked-notes-attachment-integration-"),
    );
    process.env.ATTACHMENTS_DIR = attachmentDirectory;
    process.env.MAX_UPLOAD_BYTES = "104857600";
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

  it("creates, reads, and atomically updates a derived editor document", async () => {
    const created = await createNote({ title: "Integration note" });
    expect(created.content).toEqual(EMPTY_EDITOR_DOCUMENT);

    const saved = await updateNote(created.id, {
      expectedVersion: created.optimisticVersion,
      title: "Renamed integration note",
      content: richDocument,
    });
    const stored = await prisma.note.findUniqueOrThrow({
      where: { id: created.id },
    });

    expect(saved.optimisticVersion).toBe(created.optimisticVersion + 1);
    expect((await getNote(created.id)).title).toBe("Renamed integration note");
    expect(stored.contentText).toBe("A durable thought");
    expect(stored.contentHtml).toContain("<strong>thought</strong>");
  });

  it("rejects a stale save and returns the current server version", async () => {
    const created = await createNote({ title: "Conflict source" });
    const current = await updateNote(created.id, {
      expectedVersion: created.optimisticVersion,
      title: "Server edit",
      content: richDocument,
    });

    let conflict: NoteDomainError | undefined;
    try {
      await updateNote(created.id, {
        expectedVersion: created.optimisticVersion,
        title: "Stale local edit",
        content: EMPTY_EDITOR_DOCUMENT,
      });
    } catch (error) {
      conflict = error as NoteDomainError;
    }

    expect(conflict).toMatchObject({ code: "NOTE_CONFLICT", status: 409 });
    expect(conflict?.details?.current).toMatchObject({
      title: "Server edit",
      optimisticVersion: current.optimisticVersion,
    });
    expect((await getNote(created.id)).title).toBe("Server edit");
  });

  it("keeps pin, trash, restore, and paginated views consistent", async () => {
    const first = await createNote({ title: "First" });
    const second = await createNote({ title: "Second" });
    await createNote({ title: "Third" });

    const pinned = await applyNoteLifecycle(first.id, {
      action: "pin",
      expectedVersion: first.optimisticVersion,
    });
    expect(
      (await listNotes({ view: "pinned", limit: 40 })).items.map(
        ({ id }) => id,
      ),
    ).toEqual([first.id]);

    const trashed = await applyNoteLifecycle(second.id, {
      action: "trash",
      expectedVersion: second.optimisticVersion,
    });
    expect(
      (await listNotes({ view: "all", limit: 40 })).items.some(
        ({ id }) => id === second.id,
      ),
    ).toBe(false);
    expect((await listNotes({ view: "trash", limit: 40 })).items[0]?.id).toBe(
      second.id,
    );

    await applyNoteLifecycle(second.id, {
      action: "restore",
      expectedVersion: trashed.optimisticVersion,
    });
    expect(
      (await listNotes({ view: "all", limit: 40 })).items.some(
        ({ id }) => id === second.id,
      ),
    ).toBe(true);

    const pageOne = await listNotes({ view: "all", limit: 2 });
    const pageTwo = await listNotes({
      view: "all",
      limit: 2,
      cursor: pageOne.nextCursor!,
    });
    expect(pageOne.items).toHaveLength(2);
    expect(pageOne.nextCursor).not.toBeNull();
    expect(pageTwo.items).toHaveLength(1);
    expect(
      new Set([...pageOne.items, ...pageTwo.items].map(({ id }) => id)).size,
    ).toBe(3);
    expect(pinned.pinnedAt).not.toBeNull();
  });

  it("reconciles durable links atomically and resolves renamed titles", async () => {
    const target = await createNote({ title: "Original target title" });
    const source = await createNote({ title: "Source note" });
    const mentionId = crypto.randomUUID();
    const savedSource = await updateNote(source.id, {
      expectedVersion: source.optimisticVersion,
      content: linkedDocument(target.id, mentionId),
    });

    expect(
      await prisma.noteLink.findUnique({
        where: {
          sourceNoteId_mentionId: { sourceNoteId: source.id, mentionId },
        },
      }),
    ).toMatchObject({
      sourceNoteId: source.id,
      targetNoteId: target.id,
      targetKey: target.id,
      mentionId,
    });

    await updateNote(target.id, {
      expectedVersion: target.optimisticVersion,
      title: "Renamed target",
    });
    const resolved = await getNote(source.id);
    expect(resolved.mentionTargets).toEqual([
      { id: target.id, title: "Renamed target", state: "active" },
    ]);
    expect(resolved.content).toEqual(savedSource.content);
    expect(JSON.stringify(resolved.content)).toContain("Original target title");

    await prisma.note.update({
      where: { id: target.id },
      data: { archivedAt: new Date() },
    });
    expect((await getNote(source.id)).mentionTargets).toEqual([
      { id: target.id, title: "Renamed target", state: "archived" },
    ]);
    await prisma.note.update({
      where: { id: target.id },
      data: { archivedAt: null },
    });
  });

  it("preserves existing links when a stale content save is rejected", async () => {
    const target = await createNote({ title: "Stable target" });
    const source = await createNote({ title: "Concurrent source" });
    const saved = await updateNote(source.id, {
      expectedVersion: source.optimisticVersion,
      content: linkedDocument(target.id),
    });

    await expect(
      updateNote(source.id, {
        expectedVersion: source.optimisticVersion,
        content: EMPTY_EDITOR_DOCUMENT,
      }),
    ).rejects.toMatchObject({ code: "NOTE_CONFLICT" });

    expect(
      await prisma.noteLink.count({ where: { sourceNoteId: source.id } }),
    ).toBe(1);
    expect((await getNote(source.id)).optimisticVersion).toBe(
      saved.optimisticVersion,
    );
  });

  it("retains broken-reference identity after permanent target deletion", async () => {
    const target = await createNote({ title: "Temporary target" });
    const source = await createNote({ title: "Durable source" });
    const firstMentionId = crypto.randomUUID();
    const secondMentionId = crypto.randomUUID();
    const document = {
      type: "doc",
      content: [
        ...linkedDocument(target.id, firstMentionId).content,
        ...linkedDocument(target.id, secondMentionId).content,
      ],
    };
    const savedSource = await updateNote(source.id, {
      expectedVersion: source.optimisticVersion,
      content: document,
    });

    const trashed = await applyNoteLifecycle(target.id, {
      action: "trash",
      expectedVersion: target.optimisticVersion,
    });
    expect((await getNote(source.id)).mentionTargets[0]?.state).toBe("trashed");

    await deleteNotePermanently(target.id, {
      expectedVersion: trashed.optimisticVersion,
    });
    const brokenSource = await getNote(source.id);
    expect(brokenSource.mentionTargets).toEqual([
      { id: target.id, title: null, state: "missing" },
    ]);
    expect(JSON.stringify(brokenSource.content)).toContain(target.id);

    const retainedLinks = await prisma.noteLink.findMany({
      where: { sourceNoteId: source.id },
      orderBy: { mentionId: "asc" },
    });
    expect(retainedLinks).toHaveLength(2);
    expect(retainedLinks.every((link) => link.targetNoteId === null)).toBe(
      true,
    );
    expect(retainedLinks.every((link) => link.targetKey === target.id)).toBe(
      true,
    );
    expect((await listBacklinks(target.id)).totalMentions).toBe(2);

    await updateNote(source.id, {
      expectedVersion: savedSource.optimisticVersion,
      content: EMPTY_EDITOR_DOCUMENT,
    });
    expect(
      await prisma.noteLink.count({ where: { sourceNoteId: source.id } }),
    ).toBe(0);
  });

  it("paginates a large backlink set without duplicates or omissions", async () => {
    const target = await createNote({ title: "Backlink page target" });
    const sources = Array.from({ length: 126 }, () => ({
      id: randomUUID(),
      title: "Backlink page source",
      content: EMPTY_EDITOR_DOCUMENT as Prisma.InputJsonValue,
      contentText: "",
      contentHtml: "<p></p>",
    }));
    await prisma.note.createMany({ data: sources });
    const links = sources.map((source, index) => ({
      sourceNoteId: source.id,
      targetNoteId: target.id,
      targetKey: target.id,
      mentionId: randomUUID(),
      context: `Bounded context ${index}`,
    }));
    await prisma.noteLink.createMany({ data: links });

    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await listBacklinksPage(target.id, { cursor, limit: 50 });
      expect(page.totalMentions).toBe(126);
      for (const item of page.items) {
        for (const context of item.contexts) seen.add(context.mentionId);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(new Set(links.map(({ mentionId }) => mentionId)));

    await expect(
      listBacklinksPage(target.id, { cursor: "not-a-cursor", limit: 50 }),
    ).rejects.toMatchObject({ code: "BACKLINK_CURSOR_INVALID", status: 400 });
  });

  it("ranks prefix suggestions before partial matches with recency ties", async () => {
    const olderPrefix = await createNote({ title: "Alpha archive" });
    const newerPrefix = await createNote({ title: "Alpha project" });
    await createNote({ title: "Project alpha appendix" });
    await updateNote(olderPrefix.id, {
      expectedVersion: olderPrefix.optimisticVersion,
      title: "Alpha archive updated",
    });

    const suggestions = await searchMentionSuggestions("alpha", newerPrefix.id);
    expect(suggestions.map(({ id }) => id)).toEqual([
      olderPrefix.id,
      newerPrefix.id,
      expect.any(String),
    ]);
    expect(suggestions[1]).toMatchObject({ isSelf: true });
  });

  it("ranks an older prefix ahead of more than fifty newer partial matches", async () => {
    const prefix = await createNote({ title: "Needle reference" });
    await prisma.note.createMany({
      data: Array.from({ length: 55 }, (_, index) => ({
        title: `Recent result ${index} contains needle`,
        content: EMPTY_EDITOR_DOCUMENT as Prisma.InputJsonValue,
        contentText: "",
        contentHtml: "<p></p>",
      })),
    });

    const suggestions = await searchMentionSuggestions("needle");
    expect(suggestions).toHaveLength(10);
    expect(suggestions[0]?.id).toBe(prefix.id);
  });

  it("enforces folder depth and cycles and makes folder deletion explicit", async () => {
    const folders: Array<Awaited<ReturnType<typeof createFolder>>> = [];
    let parentId: string | null = null;
    for (let depth = 1; depth <= 6; depth += 1) {
      const folder = await createFolder({
        name: `Level ${depth}`,
        parentId,
        sortOrder: depth,
      });
      folders.push(folder);
      parentId = folder.id;
    }

    await expect(
      createFolder({ name: "Too deep", parentId, sortOrder: 0 }),
    ).rejects.toMatchObject({ code: "FOLDER_DEPTH_EXCEEDED", status: 409 });
    await expect(
      updateFolder(folders[0]!.id, { parentId: folders[5]!.id }),
    ).rejects.toMatchObject({ code: "FOLDER_CYCLE", status: 409 });

    const directNote = await createNote({
      title: "Direct child note",
      folderId: folders[0]!.id,
    });
    await deleteFolder(folders[0]!.id, { strategy: "move-to-parent" });
    expect((await getNote(directNote.id)).folder).toBeNull();
    expect((await getOrganization()).folders).toHaveLength(5);

    const doomedRoot = await createFolder({
      name: "Doomed root",
      parentId: null,
      sortOrder: 0,
    });
    const doomedChild = await createFolder({
      name: "Doomed child",
      parentId: doomedRoot.id,
      sortOrder: 0,
    });
    const doomedNote = await createNote({
      title: "Doomed note",
      folderId: doomedChild.id,
    });
    await deleteFolder(doomedRoot.id, { strategy: "trash-notes" });
    expect(await getNote(doomedNote.id)).toMatchObject({
      folder: null,
      trashedAt: expect.any(String),
    });
  });

  it("normalizes editable tags while preserving note associations", async () => {
    const tag = await createTag({
      name: "  Project   Atlas ",
      color: "#3366aa",
    });
    await expect(
      createTag({ name: "project atlas", color: null }),
    ).rejects.toMatchObject({ code: "ORGANIZATION_CONFLICT", status: 409 });

    const note = await createNote({
      title: "Tagged at creation",
      tagIds: [tag.id],
    });
    const renamed = await updateTag(tag.id, {
      name: "Atlas Work",
      color: "#aa6633",
    });
    expect(renamed).toMatchObject({
      id: tag.id,
      normalizedName: "atlas work",
      displayName: "Atlas Work",
      color: "#aa6633",
      noteCount: 1,
    });
    expect((await getNote(note.id)).tags).toEqual([
      { id: tag.id, displayName: "Atlas Work", color: "#aa6633" },
    ]);
  });

  it("rolls back a stale bulk action and applies valid move, tag, and archive actions", async () => {
    const folder = await createFolder({
      name: "Bulk destination",
      parentId: null,
      sortOrder: 0,
    });
    const tag = await createTag({ name: "Bulk tag", color: null });
    const first = await createNote({ title: "Bulk one" });
    const second = await createNote({ title: "Bulk two" });

    await expect(
      applyBulkNoteAction({
        action: "move",
        folderId: folder.id,
        notes: [
          { id: first.id, expectedVersion: first.optimisticVersion },
          { id: second.id, expectedVersion: second.optimisticVersion + 1 },
        ],
      }),
    ).rejects.toMatchObject({ code: "BULK_CONFLICT", status: 409 });
    expect((await getNote(first.id)).folder).toBeNull();

    const moved = await applyBulkNoteAction({
      action: "move",
      folderId: folder.id,
      notes: [
        { id: first.id, expectedVersion: first.optimisticVersion },
        { id: second.id, expectedVersion: second.optimisticVersion },
      ],
    });
    const tagged = await applyBulkNoteAction({
      action: "tag",
      tagIds: [tag.id],
      notes: moved.items.map(({ id, optimisticVersion }) => ({
        id,
        expectedVersion: optimisticVersion,
      })),
    });
    const archived = await applyBulkNoteAction({
      action: "archive",
      notes: tagged.items.map(({ id, optimisticVersion }) => ({
        id,
        expectedVersion: optimisticVersion,
      })),
    });
    expect(archived.items.every(({ archivedAt }) => archivedAt !== null)).toBe(
      true,
    );
    expect(await getNote(first.id)).toMatchObject({
      folder: { id: folder.id },
      tags: [{ id: tag.id }],
      archivedAt: expect.any(String),
    });
  });

  it("ranks title matches first and filters full-text search by lifecycle and metadata", async () => {
    const folder = await createFolder({
      name: "Search scope",
      parentId: null,
      sortOrder: 0,
    });
    const tag = await createTag({ name: "Research", color: "#4f46e5" });
    const titleMatch = await createNote({
      title: "Orchid launch plan",
      folderId: folder.id,
      tagIds: [tag.id],
    });
    const bodyMatch = await createNote({ title: "Garden observations" });
    await updateNote(bodyMatch.id, {
      expectedVersion: bodyMatch.optimisticVersion,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "The rare orchid bloomed today." }],
          },
        ],
      },
    });

    const searchInput = {
      q: "orchid",
      view: "all" as const,
      attachments: "any" as const,
      sort: "relevance" as const,
      direction: "desc" as const,
      offset: 0,
      limit: 40,
    };
    const results = await searchNotes(searchInput);
    expect(results.items.map(({ id }) => id)).toEqual([
      titleMatch.id,
      bodyMatch.id,
    ]);
    expect(results.items[0]?.titleHighlight).toContain("<mark>Orchid</mark>");
    expect(results.items[1]?.highlight).toContain("<mark>orchid</mark>");
    expect(
      await searchNotes({
        ...searchInput,
        folderId: folder.id,
        tagIds: [tag.id],
      }),
    ).toMatchObject({ items: [{ id: titleMatch.id }] });

    const archived = await applyNoteLifecycle(titleMatch.id, {
      action: "archive",
      expectedVersion: titleMatch.optimisticVersion,
    });
    expect((await searchNotes(searchInput)).items.map(({ id }) => id)).toEqual([
      bodyMatch.id,
    ]);
    expect(
      (
        await searchNotes({
          ...searchInput,
          view: "archive",
          folderId: folder.id,
        })
      ).items[0],
    ).toMatchObject({ id: titleMatch.id, archivedAt: archived.archivedAt });

    const indexes = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'Note_content_search_idx'
    `;
    expect(indexes[0]?.indexdef).toContain("USING gin");
  });

  it("defaults trash retention to never and deletes only after it is configured", async () => {
    const note = await createNote({ title: "Retention candidate" });
    await prisma.note.update({
      where: { id: note.id },
      data: { trashedAt: new Date("2020-01-01T00:00:00.000Z") },
    });
    await listNotes({ view: "trash", limit: 40 });
    expect(await prisma.note.count({ where: { id: note.id } })).toBe(1);

    await setTrashRetention({ days: 30 });
    await listNotes({ view: "trash", limit: 40 });
    expect(await prisma.note.count({ where: { id: note.id } })).toBe(0);
  });

  it("streams representative files, derives safe metadata, and downloads byte-for-byte", async () => {
    let note = await createNote({ title: "Attachment formats" });
    const fixtures = [
      {
        name: "manual.pdf",
        declared: "application/pdf",
        bytes: Buffer.from("%PDF-1.7\nlocal test"),
        mimeType: "application/pdf",
      },
      {
        name: "record.json",
        declared: "application/json",
        bytes: Buffer.from('{"linked":true}'),
        mimeType: "application/json",
      },
      {
        name: "pixel.png",
        declared: "image/png",
        bytes: pngFixture(3, 2),
        mimeType: "image/png",
      },
      {
        name: "photo.jpg",
        declared: "image/jpeg",
        bytes: Buffer.from("ffd8ffe000104a4649460001ffd9", "hex"),
        mimeType: "image/jpeg",
      },
      {
        name: "notes.docx",
        declared:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        bytes: Buffer.concat([
          Buffer.from("504b0304", "hex"),
          Buffer.from("[Content_Types].xml word/document.xml"),
        ]),
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
      {
        name: "unknown.bin",
        declared: "application/x-custom",
        bytes: Buffer.from([0, 1, 2, 3, 4, 5]),
        mimeType: "application/octet-stream",
      },
    ];

    for (const fixture of fixtures) {
      const result = await uploadAttachment(
        note.id,
        {
          filename: fixture.name,
          expectedVersion: note.optimisticVersion,
          contentLength: fixture.bytes.length,
          declaredMimeType: fixture.declared,
        },
        chunks(fixture.bytes, 3),
      );
      note = result.note;
      expect(result.attachment).toMatchObject({
        originalName: fixture.name,
        mimeType: fixture.mimeType,
        byteSize: fixture.bytes.length,
        checksumSha256: createHash("sha256")
          .update(fixture.bytes)
          .digest("hex"),
        available: true,
      });
      if (fixture.mimeType === "image/png") {
        expect(result.attachment).toMatchObject({ width: 3, height: 2 });
      }
      const download = await getAttachmentDownload(result.attachment.id);
      expect(await collect(download.stream)).toEqual(fixture.bytes);
    }

    expect(
      (await listNoteAttachments(note.id, { limit: 100 })).items,
    ).toHaveLength(fixtures.length);
    expect(
      (await listNotes({ view: "all", limit: 40, attachments: "with" }))
        .items[0],
    ).toMatchObject({ id: note.id, attachmentCount: fixtures.length });
  });

  it("rejects stale, oversized, misleading, and interrupted uploads without orphaning bytes", async () => {
    const note = await createNote({ title: "Unsafe upload cases" });
    const misleading = Buffer.from("<svg onload=alert(1)></svg>");
    const uploaded = await uploadAttachment(
      note.id,
      {
        filename: "../../unsafe\r\n.svg",
        expectedVersion: note.optimisticVersion,
        contentLength: misleading.length,
        declaredMimeType: "image/svg+xml",
      },
      chunks(misleading, 4),
    );
    expect(uploaded.attachment).toMatchObject({
      originalName: ".._.._unsafe.svg",
      mimeType: "application/octet-stream",
      previewUrl: null,
    });
    const storedBefore = await listStoredFileNames();

    await expect(
      uploadAttachment(
        note.id,
        {
          filename: "stale.bin",
          expectedVersion: note.optimisticVersion,
          contentLength: 4,
          declaredMimeType: "application/octet-stream",
        },
        chunks(Buffer.from("test"), 2),
      ),
    ).rejects.toMatchObject({ code: "ATTACHMENT_CONFLICT", status: 409 });

    process.env.MAX_UPLOAD_BYTES = "8";
    await expect(
      uploadAttachment(
        note.id,
        {
          filename: "large.bin",
          expectedVersion: uploaded.note.optimisticVersion,
          contentLength: null,
          declaredMimeType: "application/octet-stream",
        },
        chunks(Buffer.alloc(9), 2),
      ),
    ).rejects.toMatchObject({ code: "ATTACHMENT_TOO_LARGE", status: 413 });
    process.env.MAX_UPLOAD_BYTES = "104857600";

    await expect(
      uploadAttachment(
        note.id,
        {
          filename: "interrupted.bin",
          expectedVersion: uploaded.note.optimisticVersion,
          contentLength: null,
          declaredMimeType: "application/octet-stream",
        },
        interruptedChunks(),
      ),
    ).rejects.toThrow("Simulated interruption");
    expect(await listStoredFileNames()).toEqual(storedBefore);
  });

  it("reports missing and corrupt bytes and repairs only unreferenced storage", async () => {
    const note = await createNote({ title: "Reconciliation" });
    const first = await uploadAttachment(
      note.id,
      {
        filename: "missing.txt",
        expectedVersion: note.optimisticVersion,
        contentLength: 7,
        declaredMimeType: "text/plain",
      },
      chunks(Buffer.from("missing"), 3),
    );
    const second = await uploadAttachment(
      note.id,
      {
        filename: "corrupt.txt",
        expectedVersion: first.note.optimisticVersion,
        contentLength: 7,
        declaredMimeType: "text/plain",
      },
      chunks(Buffer.from("correct"), 3),
    );
    const records = await prisma.attachment.findMany({
      where: { id: { in: [first.attachment.id, second.attachment.id] } },
    });
    const missing = records.find(({ id }) => id === first.attachment.id)!;
    const corrupt = records.find(({ id }) => id === second.attachment.id)!;
    await unlink(path.join(attachmentDirectory, missing.storageName));
    await writeFile(
      path.join(attachmentDirectory, corrupt.storageName),
      Buffer.from("changed"),
    );
    const orphanName = randomUUID();
    await writeFile(path.join(attachmentDirectory, orphanName), "orphan");

    const listed = await listNoteAttachments(note.id, { limit: 100 });
    expect(listed.items.find(({ id }) => id === missing.id)).toMatchObject({
      available: false,
      unavailableReason: "missing",
    });
    await expect(getAttachmentDownload(missing.id)).rejects.toMatchObject({
      code: "ATTACHMENT_BYTES_MISSING",
      status: 410,
    });

    const report = await reconcileAttachments({ repairOrphans: false });
    expect(report.missingAttachmentIds).toContain(missing.id);
    expect(report.corruptAttachmentIds).toContain(corrupt.id);
    expect(report.orphanedStorageNames).toContain(orphanName);

    const repaired = await reconcileAttachments({ repairOrphans: true });
    expect(repaired.repair?.orphanedBytes.deleted).toBe(1);
    await expect(
      access(path.join(attachmentDirectory, orphanName)),
    ).rejects.toThrow();
    expect(await prisma.attachment.count()).toBe(2);
  });

  it("removes bytes after attachment, permanent-note, and retention transactions", async () => {
    let note = await createNote({ title: "Delete attachment bytes" });
    const uploaded = await uploadAttachment(
      note.id,
      {
        filename: "remove.txt",
        expectedVersion: note.optimisticVersion,
        contentLength: 6,
        declaredMimeType: "text/plain",
      },
      chunks(Buffer.from("remove"), 2),
    );
    const stored = await prisma.attachment.findUniqueOrThrow({
      where: { id: uploaded.attachment.id },
    });
    const removed = await deleteAttachment(uploaded.attachment.id, {
      expectedVersion: uploaded.note.optimisticVersion,
    });
    note = removed.note;
    await expect(
      readFile(path.join(attachmentDirectory, stored.storageName)),
    ).rejects.toThrow();

    const permanent = await uploadAttachment(
      note.id,
      {
        filename: "permanent.txt",
        expectedVersion: note.optimisticVersion,
        contentLength: 9,
        declaredMimeType: "text/plain",
      },
      chunks(Buffer.from("permanent"), 3),
    );
    const permanentRecord = await prisma.attachment.findUniqueOrThrow({
      where: { id: permanent.attachment.id },
    });
    const trashed = await applyNoteLifecycle(note.id, {
      action: "trash",
      expectedVersion: permanent.note.optimisticVersion,
    });
    await deleteNotePermanently(note.id, {
      expectedVersion: trashed.optimisticVersion,
    });
    await expect(
      access(path.join(attachmentDirectory, permanentRecord.storageName)),
    ).rejects.toThrow();

    const retainedNote = await createNote({ title: "Retention bytes" });
    const retained = await uploadAttachment(
      retainedNote.id,
      {
        filename: "retained.txt",
        expectedVersion: retainedNote.optimisticVersion,
        contentLength: 8,
        declaredMimeType: "text/plain",
      },
      chunks(Buffer.from("retained"), 2),
    );
    const retainedRecord = await prisma.attachment.findUniqueOrThrow({
      where: { id: retained.attachment.id },
    });
    await prisma.note.update({
      where: { id: retainedNote.id },
      data: { trashedAt: new Date("2020-01-01T00:00:00.000Z") },
    });
    await setTrashRetention({ days: 30 });
    await listNotes({ view: "trash", limit: 40 });
    await expect(
      access(path.join(attachmentDirectory, retainedRecord.storageName)),
    ).rejects.toThrow();
  });
});

async function* chunks(value: Buffer, size: number) {
  for (let offset = 0; offset < value.length; offset += size) {
    yield value.subarray(offset, offset + size);
  }
}

async function* interruptedChunks() {
  yield Buffer.from("partial");
  throw new Error("Simulated interruption");
}

async function collect(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function pngFixture(width: number, height: number) {
  const value = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(value);
  value.writeUInt32BE(width, 16);
  value.writeUInt32BE(height, 20);
  return value;
}
