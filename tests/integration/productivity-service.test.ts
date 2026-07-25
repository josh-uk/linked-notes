import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { EMPTY_EDITOR_DOCUMENT } from "@/features/notes/document-schema";
import { prisma } from "@/server/db";
import { importMarkdownFiles } from "@/server/imports/markdown-import-service";
import {
  listNoteHistory,
  restoreNoteRevision,
  updateNote,
} from "@/server/notes/note-service";
import {
  createNoteTemplate,
  getOrCreateDailyNote,
} from "@/server/notes/productivity-service";
import { createNote } from "@/server/notes/note-service";

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";

describe("productivity and migration services", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  beforeEach(async () => {
    await prisma.note.deleteMany();
    await prisma.noteTemplate.deleteMany();
    await prisma.folder.deleteMany();
    await prisma.tag.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("captures restorable note history without losing the current version", async () => {
    const created = await createNote({ title: "Original title" });
    const changed = await updateNote(created.id, {
      expectedVersion: created.optimisticVersion,
      title: "Changed title",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Changed content" }],
          },
        ],
      },
    });
    const history = await listNoteHistory(created.id, { limit: 30 });

    expect(history.items[0]).toMatchObject({
      noteVersion: created.optimisticVersion,
      title: "Original title",
      reason: "edit",
    });
    const restored = await restoreNoteRevision(created.id, {
      revisionId: history.items[0]!.id,
      expectedVersion: changed.optimisticVersion,
    });
    expect(restored).toMatchObject({
      title: "Original title",
      content: EMPTY_EDITOR_DOCUMENT,
      optimisticVersion: changed.optimisticVersion + 1,
    });
    expect((await listNoteHistory(created.id, { limit: 30 })).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          noteVersion: changed.optimisticVersion,
          title: "Changed title",
          reason: "restore",
        }),
      ]),
    );
  });

  it("creates notes from templates and reuses one daily note per local date", async () => {
    const template = await createNoteTemplate({
      name: "Daily stand-up",
      title: "Stand-up",
      content: {
        type: "doc",
        content: [
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { checked: false },
                content: [{ type: "paragraph" }],
              },
            ],
          },
        ],
      },
    });
    const first = await getOrCreateDailyNote({
      date: "2026-07-25",
      templateId: template.id,
    });
    const second = await getOrCreateDailyNote({ date: "2026-07-25" });

    expect(first.created).toBe(true);
    expect(first.note).toMatchObject({
      title: "Stand-up",
      dailyDate: "2026-07-25",
    });
    expect(second).toMatchObject({
      created: false,
      note: { id: first.note.id },
    });
  });

  it("previews and imports nested Markdown while reconnecting durable links", async () => {
    const files = [
      {
        path: "Imported/Source.md",
        content: `# Source

Created: 2026-01-01T00:00:00.000Z${"  "}
Updated: 2026-01-02T00:00:00.000Z${"  "}
Note ID: ${firstId}

See [@Target](linked-notes://note/${secondId}).`,
      },
      {
        path: "Imported/Target.md",
        content: `# Target

Created: 2026-01-01T00:00:00.000Z${"  "}
Updated: 2026-01-02T00:00:00.000Z${"  "}
Note ID: ${secondId}

Target content.`,
      },
    ];
    const preview = await importMarkdownFiles({ files, commit: false });
    expect(preview).toMatchObject({
      committed: false,
      summary: { total: 2, new: 2, existing: 0 },
    });

    const imported = await importMarkdownFiles({ files, commit: true });
    expect(imported).toMatchObject({
      committed: true,
      summary: { created: 2, skipped: 0 },
    });
    const source = await prisma.note.findFirstOrThrow({
      where: { title: "Source" },
      include: { outboundLinks: true, folder: true },
    });
    const target = await prisma.note.findFirstOrThrow({
      where: { title: "Target" },
    });
    expect(source.folder?.name).toBe("Imported");
    expect(source.outboundLinks[0]).toMatchObject({
      targetNoteId: target.id,
      targetKey: target.id,
    });

    const repeated = await importMarkdownFiles({ files, commit: true });
    expect(repeated.summary).toMatchObject({ created: 0, skipped: 2 });
    expect(await prisma.note.count()).toBe(2);
  });
});
