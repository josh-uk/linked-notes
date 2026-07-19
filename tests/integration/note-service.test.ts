import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { EMPTY_EDITOR_DOCUMENT } from "@/features/notes/document-schema";
import { prisma } from "@/server/db";
import { NoteDomainError } from "@/server/notes/note-errors";
import {
  applyNoteLifecycle,
  createNote,
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
});
