import { z } from "zod";

import type { EditorDocument, EditorNode } from "./types";

export const EDITOR_DOCUMENT_SCHEMA_VERSION = 1;

export const EMPTY_EDITOR_DOCUMENT: EditorDocument = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

const allowedNodeTypes = new Set([
  "doc",
  "paragraph",
  "text",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "horizontalRule",
  "codeBlock",
  "hardBreak",
  "mention",
]);

const allowedMarkTypes = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "link",
]);

const markSchema = z
  .object({
    type: z.string().min(1).max(50),
    attrs: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .superRefine((mark, context) => {
    if (!allowedMarkTypes.has(mark.type)) {
      context.addIssue({
        code: "custom",
        message: `Unsupported editor mark: ${mark.type}`,
      });
    }

    if (mark.type === "link") {
      const href = mark.attrs?.href;
      if (typeof href !== "string" || !isSafeLink(href)) {
        context.addIssue({
          code: "custom",
          message: "Link marks require a safe URL",
        });
      }
    }
  });

const nodeSchema: z.ZodType<EditorNode> = z.lazy(() =>
  z
    .object({
      type: z.string().min(1).max(50),
      attrs: z.record(z.string(), z.unknown()).optional(),
      content: z.array(nodeSchema).max(20_000).optional(),
      marks: z.array(markSchema).max(20).optional(),
      text: z.string().max(2_000_000).optional(),
    })
    .strict()
    .superRefine((node, context) => {
      if (!allowedNodeTypes.has(node.type)) {
        context.addIssue({
          code: "custom",
          message: `Unsupported editor node: ${node.type}`,
        });
      }

      if (node.type === "doc" && node.text !== undefined) {
        context.addIssue({
          code: "custom",
          message: "Document nodes cannot contain text directly",
        });
      }

      if (node.type === "text" && typeof node.text !== "string") {
        context.addIssue({
          code: "custom",
          message: "Text nodes require text",
        });
      }

      if (node.type !== "text" && node.text !== undefined) {
        context.addIssue({
          code: "custom",
          message: `${node.type} nodes cannot contain text directly`,
        });
      }

      if (node.type === "heading") {
        const level = node.attrs?.level;
        if (level !== 1 && level !== 2 && level !== 3) {
          context.addIssue({
            code: "custom",
            message: "Heading level must be 1, 2, or 3",
          });
        }
      }

      if (
        node.type === "taskItem" &&
        typeof node.attrs?.checked !== "boolean"
      ) {
        context.addIssue({
          code: "custom",
          message: "Task items require a checked state",
        });
      }

      if (node.type === "mention") {
        if (!z.string().uuid().safeParse(node.attrs?.id).success) {
          context.addIssue({
            code: "custom",
            message: "Mention nodes require an immutable target ID",
          });
        }
        if (!z.string().uuid().safeParse(node.attrs?.mentionId).success) {
          context.addIssue({
            code: "custom",
            message: "Mention nodes require a unique mention instance ID",
          });
        }
        if (
          typeof node.attrs?.label !== "string" ||
          node.attrs.label.length > 500
        ) {
          context.addIssue({
            code: "custom",
            message: "Mention nodes require a bounded fallback label",
          });
        }
        if (node.content?.length) {
          context.addIssue({
            code: "custom",
            message: "Mention nodes cannot contain child content",
          });
        }
      }
    }),
);

export const editorDocumentSchema = nodeSchema.superRefine(
  (document, context) => {
    if (document.type !== "doc") {
      context.addIssue({
        code: "custom",
        message: "Editor content must start with a doc node",
      });
    }

    const mentionIds = new Set<string>();
    visitEditorNodes(document, (node) => {
      if (node.type !== "mention") return;
      const mentionId = node.attrs?.mentionId;
      if (typeof mentionId !== "string") return;
      if (mentionIds.has(mentionId)) {
        context.addIssue({
          code: "custom",
          message: "Mention instance IDs must be unique within a note",
        });
      }
      mentionIds.add(mentionId);
    });
  },
);

function visitEditorNodes(
  node: EditorNode,
  visitor: (node: EditorNode) => void,
) {
  visitor(node);
  for (const child of node.content ?? []) visitEditorNodes(child, visitor);
}

export function parseEditorDocument(value: unknown): EditorDocument {
  return editorDocumentSchema.parse(value) as EditorDocument;
}

export function isSafeLink(href: string): boolean {
  const trimmed = href.trim();
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return true;

  try {
    const url = new URL(trimmed);
    return (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "mailto:"
    );
  } catch {
    return false;
  }
}
