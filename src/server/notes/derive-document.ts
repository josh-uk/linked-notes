import { generateText, type JSONContent } from "@tiptap/core";
import { generateHTML } from "@tiptap/html";
import sanitizeHtml from "sanitize-html";

import { parseEditorDocument } from "@/features/notes/document-schema";
import { createEditorExtensions } from "@/features/notes/editor-extensions";

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
  const renderedHtml = generateHTML(document, serverExtensions);
  const sanitizedHtml = sanitizeHtml(renderedHtml, {
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
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { a: ["http", "https", "mailto"] },
    allowProtocolRelative: false,
    enforceHtmlBoundary: true,
  });

  return { content, plainText, sanitizedHtml };
}
