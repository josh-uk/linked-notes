import { describe, expect, it } from "vitest";

import { parseEditorDocument } from "@/features/notes/document-schema";
import { extractMentions } from "@/features/notes/mention-document";

const targetId = "6de084a2-c5d5-44c4-b0b7-b0da440ca138";
const firstMentionId = "d468b47d-b93c-44e0-9673-08c53171ddc6";
const secondMentionId = "8031dc52-302d-45ff-874a-882564ab6ed0";

describe("mention documents", () => {
  it("extracts stable targets, distinct instances, and local context", () => {
    const document = parseEditorDocument({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Compare " },
            {
              type: "mention",
              attrs: {
                id: targetId,
                mentionId: firstMentionId,
                label: "Project Atlas",
              },
            },
            { type: "text", text: " with the earlier plan." },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Revisit " },
            {
              type: "mention",
              attrs: {
                id: targetId,
                mentionId: secondMentionId,
                label: "Project Atlas",
              },
            },
            { type: "text", text: " after review." },
          ],
        },
      ],
    });

    expect(extractMentions(document)).toEqual([
      expect.objectContaining({
        targetId,
        mentionId: firstMentionId,
        context: expect.stringContaining("Compare @Project Atlas"),
      }),
      expect.objectContaining({
        targetId,
        mentionId: secondMentionId,
        context: expect.stringContaining("Revisit @Project Atlas"),
      }),
    ]);
  });

  it("rejects malformed and duplicate mention identities", () => {
    expect(() =>
      parseEditorDocument({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "mention",
                attrs: {
                  id: "not-a-note-id",
                  mentionId: firstMentionId,
                  label: "Unsafe",
                },
              },
            ],
          },
        ],
      }),
    ).toThrow("immutable target ID");

    expect(() =>
      parseEditorDocument({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "mention",
                attrs: {
                  id: targetId,
                  mentionId: firstMentionId,
                  label: "First",
                },
              },
              {
                type: "mention",
                attrs: {
                  id: targetId,
                  mentionId: firstMentionId,
                  label: "Duplicate",
                },
              },
            ],
          },
        ],
      }),
    ).toThrow("must be unique");
  });
});
