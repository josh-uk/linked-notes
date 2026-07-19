import { describe, expect, it } from "vitest";

import {
  EMPTY_EDITOR_DOCUMENT,
  parseEditorDocument,
} from "@/features/notes/document-schema";
import { deriveEditorDocument } from "@/server/notes/derive-document";

describe("editor documents", () => {
  it("accepts the supported rich-text shape and derives safe output", () => {
    const document = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Project notes" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "A " },
            { type: "text", text: "useful", marks: [{ type: "bold" }] },
            {
              type: "text",
              text: " link",
              marks: [
                { type: "link", attrs: { href: "https://example.test/path" } },
              ],
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
                  content: [{ type: "text", text: "Done" }],
                },
              ],
            },
          ],
        },
      ],
    };

    const derived = deriveEditorDocument(document);

    expect(derived.plainText).toContain("Project notes");
    expect(derived.plainText).toContain("A useful link");
    expect(derived.sanitizedHtml).toContain("<strong>useful</strong>");
    expect(derived.sanitizedHtml).toContain('href="https://example.test/path"');
    expect(derived.sanitizedHtml).not.toContain("<script");
  });

  it("rejects unsupported nodes and active URL schemes", () => {
    expect(() =>
      parseEditorDocument({ type: "doc", content: [{ type: "iframe" }] }),
    ).toThrow("Unsupported editor node");

    expect(() =>
      parseEditorDocument({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "unsafe",
                marks: [
                  { type: "link", attrs: { href: "javascript:alert(1)" } },
                ],
              },
            ],
          },
        ],
      }),
    ).toThrow("safe URL");

    for (const href of [
      "//attacker.test/path",
      "/\\attacker.test/path",
      "https://user:secret@example.test/",
      "https://example.test/\npath",
      "data:text/html,<script>alert(1)</script>",
    ]) {
      expect(() =>
        parseEditorDocument({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "unsafe",
                  marks: [{ type: "link", attrs: { href } }],
                },
              ],
            },
          ],
        }),
      ).toThrow("safe URL");
    }
  });

  it("bounds complete document depth, node count, and text", () => {
    let nested: Record<string, unknown> = { type: "paragraph" };
    for (let depth = 0; depth < 34; depth += 1) {
      nested = { type: "blockquote", content: [nested] };
    }
    expect(() =>
      parseEditorDocument({ type: "doc", content: [nested] }),
    ).toThrow("nesting limit");

    expect(() =>
      parseEditorDocument({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "x".repeat(1_000_001) }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "y".repeat(1_000_000) }],
          },
        ],
      }),
    ).toThrow("text limit");
  });

  it("escapes stored markup and active attributes in derived HTML", () => {
    const derived = deriveEditorDocument({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: '<img src=x onerror="document.body.dataset.pwned=1">',
            },
          ],
        },
      ],
    });
    expect(derived.sanitizedHtml).toContain("&lt;img src=x onerror=");
    expect(derived.sanitizedHtml).not.toContain("<img");
  });

  it("provides a valid empty document", () => {
    expect(parseEditorDocument(EMPTY_EDITOR_DOCUMENT)).toEqual(
      EMPTY_EDITOR_DOCUMENT,
    );
  });

  it("keeps unresolved durable mentions as neutral fallback links", () => {
    const derived = deriveEditorDocument({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "mention",
              attrs: {
                id: "346cc6c4-7f53-4a0c-9349-f76a6fdbcc2c",
                mentionId: "52a87d87-7ea7-45af-bc6d-bc6a754048d5",
                label: "Immutable fallback",
              },
            },
          ],
        },
      ],
    });

    expect(derived.plainText).toBe("@Immutable fallback");
    expect(derived.sanitizedHtml).toContain('data-state="active"');
    expect(derived.sanitizedHtml).not.toContain("missing");
  });
});
