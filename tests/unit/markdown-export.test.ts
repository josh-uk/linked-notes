import { describe, expect, it } from "vitest";

import type { EditorDocument } from "@/features/notes/types";
import { renderNoteMarkdown } from "@/server/exports/markdown";

const targetId = "11111111-1111-4111-8111-111111111111";
const missingId = "22222222-2222-4222-8222-222222222222";

describe("Markdown note export", () => {
  it("preserves readable rich structure and durable note-link meaning", () => {
    const content: EditorDocument = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Plan" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Use ", marks: [{ type: "bold" }] },
            {
              type: "text",
              text: "local docs",
              marks: [
                { type: "italic" },
                { type: "link", attrs: { href: "https://example.test/a(b)" } },
              ],
            },
            { type: "text", text: " with " },
            {
              type: "mention",
              attrs: {
                id: targetId,
                mentionId: "33333333-3333-4333-8333-333333333333",
                label: "Old title",
              },
            },
            { type: "text", text: " and " },
            {
              type: "mention",
              attrs: {
                id: missingId,
                mentionId: "44444444-4444-4444-8444-444444444444",
                label: "Removed note",
              },
            },
          ],
        },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Ship backup" }],
                },
              ],
            },
          ],
        },
        {
          type: "codeBlock",
          content: [{ type: "text", text: "const value = `local`;" }],
        },
      ],
    };

    const markdown = renderNoteMarkdown({
      note: {
        id: "55555555-5555-4555-8555-555555555555",
        title: "Phase #5",
        content,
        createdAt: new Date("2026-07-19T10:00:00.000Z"),
        updatedAt: new Date("2026-07-19T11:00:00.000Z"),
      },
      mentionTargets: [
        { id: targetId, title: "Renamed note", state: "active" },
        { id: missingId, title: null, state: "missing" },
      ],
      attachments: [
        {
          originalName: "local.json",
          mimeType: "application/json",
          byteSize: 12,
          checksumSha256: "a".repeat(64),
        },
      ],
    });

    expect(markdown).toContain("# Phase \\#5");
    expect(markdown).toContain("## Plan");
    expect(markdown).toContain("**Use **");
    expect(markdown).toContain("[_local docs_](https://example.test/a%28b%29)");
    expect(markdown).toContain(
      `[@Renamed note](linked-notes://note/${targetId})`,
    );
    expect(markdown).toContain(
      `[@Removed note](linked-notes://note/${missingId}) (missing)`,
    );
    expect(markdown).toContain("- [x] Ship backup");
    expect(markdown).toContain("``\nconst value = `local`;\n``");
    expect(markdown).toContain("## Attachments");
    expect(markdown).toContain("local.json (application/json, 12 B");
  });
});
