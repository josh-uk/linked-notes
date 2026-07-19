import { describe, expect, it } from "vitest";

import { noteExportInputSchema } from "@/server/exports/note-export-service";
import { buildNotePrintHtml } from "@/server/exports/pdf-renderer";

describe("PDF print renderer", () => {
  it("parses explicit backlink query booleans without truthy-string coercion", () => {
    expect(
      noteExportInputSchema.parse({ format: "pdf", backlinks: "false" }),
    ).toMatchObject({ backlinks: false });
    expect(
      noteExportInputSchema.parse({ format: "pdf", backlinks: "true" }),
    ).toMatchObject({ backlinks: true });
  });

  it("builds escaped, self-contained print HTML without network-backed resources", () => {
    const html = buildNotePrintHtml({
      note: {
        id: "11111111-1111-4111-8111-111111111111",
        title: '<img src="https://attacker.test/title">',
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "A safe external hyperlink",
                  marks: [
                    {
                      type: "link",
                      attrs: { href: "https://example.test/read" },
                    },
                  ],
                },
              ],
            },
          ],
        },
        createdAt: new Date("2026-07-19T10:00:00.000Z"),
        updatedAt: new Date("2026-07-19T11:00:00.000Z"),
        folderName: "<Work>",
        tags: [{ displayName: "A&B", color: null }],
      },
      mentionTargets: [],
      attachments: [
        {
          originalName: 'image" onerror="alert(1).png',
          mimeType: "image/png",
          byteSize: 3,
          checksumSha256: "a".repeat(64),
          width: 1,
          height: 1,
          available: true,
          embeddedDataUrl: "data:image/png;base64,YWJj",
        },
      ],
      backlinks: null,
    });

    expect(html).toContain(
      "&lt;img src=&quot;https://attacker.test/title&quot;&gt;",
    );
    expect(html).toContain("Folder: &lt;Work&gt;");
    expect(html).toContain("Tags: A&amp;B");
    expect(html).toContain('href="https://example.test/read"');
    expect(html).toContain('src="data:image/png;base64,YWJj"');
    expect(html).not.toContain('src="https://');
    expect(html).not.toContain('onerror="alert(1)');
  });

  it("labels a bounded backlink page when more mentions remain", () => {
    const html = buildNotePrintHtml({
      note: {
        id: "11111111-1111-4111-8111-111111111111",
        title: "Bounded export",
        content: { type: "doc", content: [{ type: "paragraph" }] },
        createdAt: new Date("2026-07-19T10:00:00.000Z"),
        updatedAt: new Date("2026-07-19T11:00:00.000Z"),
        folderName: null,
        tags: [],
      },
      mentionTargets: [],
      attachments: [],
      backlinks: {
        items: [
          {
            sourceNoteId: "22222222-2222-4222-8222-222222222222",
            sourceTitle: "Source <unsafe>",
            sourceState: "active",
            sourceUpdatedAt: "2026-07-19T11:00:00.000Z",
            contexts: [
              {
                mentionId: "33333333-3333-4333-8333-333333333333",
                context: "Escaped <context>",
              },
            ],
          },
        ],
        totalMentions: 125,
        nextCursor: "opaque-cursor",
      },
    });

    expect(html).toContain("Showing the first 1 of 125 backlink mentions");
    expect(html).toContain("Source &lt;unsafe&gt;");
    expect(html).toContain("Escaped &lt;context&gt;");
    expect(html).not.toContain("<unsafe>");
  });
});
