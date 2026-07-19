import { generateText, type JSONContent } from "@tiptap/core";
import { generateHTML } from "@tiptap/html";
import sanitizeHtml from "sanitize-html";

import { parseEditorDocument } from "@/features/notes/document-schema";
import { createEditorExtensions } from "@/features/notes/editor-extensions";
import type { MentionTarget } from "@/features/notes/types";

const serverExtensions = createEditorExtensions({ placeholder: false });

export type DerivedDocument = {
  content: ReturnType<typeof parseEditorDocument>;
  plainText: string;
  sanitizedHtml: string;
};

export function deriveEditorDocument(value: unknown): DerivedDocument {
  const content = parseEditorDocument(value);
  const document = content as JSONContent;
  const plainText = generateText(document, serverExtensions, {
    blockSeparator: "\n",
  }).trim();
  const sanitizedHtml = sanitizeRenderedHtml(
    generateHTML(document, serverExtensions),
  );

  return { content, plainText, sanitizedHtml };
}

export function renderEditorDocumentHtml(
  value: unknown,
  mention?: { currentNoteId: string; targets: MentionTarget[] },
) {
  const content = parseEditorDocument(value);
  const extensions = mention
    ? createEditorExtensions({
        placeholder: false,
        mention: { ...mention, suggestions: false },
      })
    : serverExtensions;
  return sanitizeRenderedHtml(generateHTML(content as JSONContent, extensions));
}

function sanitizeRenderedHtml(renderedHtml: string) {
  return sanitizeHtml(renderedHtml, {
    allowedTags: [
      "p",
      "h1",
      "h2",
      "h3",
      "strong",
      "em",
      "u",
      "s",
      "code",
      "pre",
      "ol",
      "ul",
      "li",
      "blockquote",
      "hr",
      "br",
      "a",
      "span",
      "div",
      "label",
      "input",
    ],
    allowedAttributes: {
      a: ["href", "rel", "target"],
      ul: ["data-type"],
      li: ["data-checked"],
      input: ["type", "checked", "disabled"],
      div: ["data-type"],
      span: [
        "class",
        "data-type",
        "data-id",
        "data-mention-id",
        "data-note-target",
        "data-state",
        "role",
        "aria-disabled",
        "aria-label",
      ],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { a: ["http", "https", "mailto"] },
    allowProtocolRelative: false,
    enforceHtmlBoundary: true,
  });
}
