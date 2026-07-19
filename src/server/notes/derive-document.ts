import { generateText, type JSONContent } from "@tiptap/core";
import sanitizeHtml from "sanitize-html";

import { parseEditorDocument } from "@/features/notes/document-schema";
import {
  createEditorExtensions,
  mentionAriaLabel,
  mentionText,
} from "@/features/notes/editor-extensions";
import type { EditorNode, MentionTarget } from "@/features/notes/types";

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
  const sanitizedHtml = sanitizeRenderedHtml(renderNode(content, new Map()));

  return { content, plainText, sanitizedHtml };
}

export function renderEditorDocumentHtml(
  value: unknown,
  mention?: { currentNoteId: string; targets: MentionTarget[] },
) {
  const content = parseEditorDocument(value);
  const targets = new Map(
    mention?.targets.map((target) => [target.id, target]) ?? [],
  );
  return sanitizeRenderedHtml(renderNode(content, targets));
}

function renderNode(
  node: EditorNode,
  targets: Map<string, MentionTarget>,
): string {
  const children = (): string =>
    (node.content ?? []).map((child) => renderNode(child, targets)).join("");

  switch (node.type) {
    case "doc":
      return children();
    case "paragraph":
      return `<p>${children()}</p>`;
    case "text":
      return renderText(node);
    case "heading": {
      const level = Number(node.attrs?.level);
      return `<h${level}>${children()}</h${level}>`;
    }
    case "bulletList":
      return `<ul>${children()}</ul>`;
    case "orderedList":
      return `<ol>${children()}</ol>`;
    case "listItem":
      return `<li>${children()}</li>`;
    case "taskList":
      return `<ul data-type="taskList">${children()}</ul>`;
    case "taskItem": {
      const checked = node.attrs?.checked === true;
      return `<li data-checked="${checked}"><label><input type="checkbox"${checked ? " checked" : ""} disabled><span></span></label><div>${children()}</div></li>`;
    }
    case "blockquote":
      return `<blockquote>${children()}</blockquote>`;
    case "horizontalRule":
      return "<hr>";
    case "codeBlock":
      return `<pre><code>${children()}</code></pre>`;
    case "hardBreak":
      return "<br>";
    case "mention":
      return renderMention(node, targets);
    default:
      return "";
  }
}

function renderText(node: EditorNode) {
  let rendered = escapeHtml(node.text ?? "");
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case "bold":
        rendered = `<strong>${rendered}</strong>`;
        break;
      case "italic":
        rendered = `<em>${rendered}</em>`;
        break;
      case "underline":
        rendered = `<u>${rendered}</u>`;
        break;
      case "strike":
        rendered = `<s>${rendered}</s>`;
        break;
      case "code":
        rendered = `<code>${rendered}</code>`;
        break;
      case "link":
        rendered = `<a href="${escapeAttribute(String(mark.attrs?.href))}" rel="noopener noreferrer nofollow" target="_blank">${rendered}</a>`;
        break;
    }
  }
  return rendered;
}

function renderMention(node: EditorNode, targets: Map<string, MentionTarget>) {
  const id = String(node.attrs?.id);
  const target = targets.get(id);
  const state = target?.state ?? "active";
  const title = target?.title || String(node.attrs?.label || "Missing note");
  const text = mentionText(node.attrs ?? {}, targets);
  return `<span class="note-mention is-${state}" data-type="mention" data-id="${escapeAttribute(id)}" data-mention-id="${escapeAttribute(String(node.attrs?.mentionId))}" data-note-target="${escapeAttribute(id)}" data-state="${state}" role="link" tabindex="0"${state === "missing" ? ' aria-disabled="true"' : ""} aria-label="${escapeAttribute(mentionAriaLabel(title, state))}">${escapeHtml(text)}</span>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replaceAll("`", "&#96;");
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
        "tabindex",
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
