import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { EMPTY_EDITOR_DOCUMENT } from "@/features/notes/document-schema";
import { prisma } from "@/server/db";
import { NoteDomainError } from "@/server/notes/note-errors";
import {
  listBacklinks,
  searchMentionSuggestions,
} from "@/server/notes/note-links";
import {
  applyNoteLifecycle,
  createNote,
  deleteNotePermanently,
  getNote,
  listNotes,
  updateNote,
} from "@/server/notes/note-service";

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
  beforeAll(() => prisma.$connect());
  beforeEach(() => prisma.note.deleteMany());
  afterAll(() => prisma.$disconnect());

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
});
