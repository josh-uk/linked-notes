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
