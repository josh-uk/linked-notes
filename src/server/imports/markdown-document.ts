import { randomUUID } from "node:crypto";

import { MarkdownManager } from "@tiptap/markdown";

import {
  EMPTY_EDITOR_DOCUMENT,
  parseEditorDocument,
} from "@/features/notes/document-schema";
import { createEditorExtensions } from "@/features/notes/editor-extensions";
import type { EditorDocument, EditorNode } from "@/features/notes/types";

const markdown = new MarkdownManager({
  extensions: createEditorExtensions({ placeholder: false }),
});
const mentionPattern =
  /\[@([^\]\n]{1,500})\]\(linked-notes:\/\/note\/([0-9a-f-]{36})\)(?: \((?:active|archived|trashed|missing)\))?/gi;

export type ParsedMarkdownDocument = {
  title: string;
  content: EditorDocument;
  tags: string[];
  createdAt: Date | null;
  updatedAt: Date | null;
  sourceType: string;
  sourceId: string;
  originalNoteId: string | null;
};

export function parseMarkdownDocument(
  path: string,
  input: string,
): ParsedMarkdownDocument {
  const { metadata, body } = stripFrontMatter(input.replaceAll("\r\n", "\n"));
  const extracted = extractHeader(body);
  const mentions: Array<{ label: string; targetId: string; token: string }> =
    [];
  const safeMarkdown = extracted.body.replace(
    mentionPattern,
    (_match, label: string, targetId: string) => {
      const token = `LNMENTION${mentions.length}END`;
      mentions.push({ label, targetId: targetId.toLowerCase(), token });
      return token;
    },
  );
  const parsed = safeMarkdown.trim()
    ? markdown.parse(safeMarkdown)
    : EMPTY_EDITOR_DOCUMENT;
  const content = insertMentions(
    parseEditorDocument(parsed),
    mentions,
    new Map(),
  );
  const originalNoteId = uuidOrNull(
    metadata["linked-notes-id"] ?? extracted.noteId,
  );
  const sourceType = boundedMetadata(
    metadata["linked-notes-source"],
    originalNoteId ? "linked-notes" : "markdown",
    50,
  );
  const sourceId = boundedMetadata(
    metadata["linked-notes-source-id"],
    originalNoteId ?? normalizeImportPath(path),
    1_000,
  );

  return {
    title: boundedTitle(
      metadata.title ?? extracted.title ?? filenameTitle(path),
    ),
    content,
    tags: parseTags(metadata.tags),
    createdAt: parseDate(metadata.created ?? extracted.created),
    updatedAt: parseDate(metadata.updated ?? extracted.updated),
    sourceType,
    sourceId,
    originalNoteId,
  };
}

export function remapImportedMentions(
  document: EditorDocument,
  targetIds: Map<string, string>,
) {
  return insertMentions(document, [], targetIds);
}

function insertMentions(
  document: EditorDocument,
  mentions: Array<{ label: string; targetId: string; token: string }>,
  targetIds: Map<string, string>,
) {
  const byToken = new Map(mentions.map((mention) => [mention.token, mention]));
  const tokenPattern = mentions.length
    ? new RegExp(`(${mentions.map(({ token }) => token).join("|")})`, "g")
    : null;

  function visit(node: EditorNode): EditorNode[] {
    if (node.type === "mention") {
      const currentId = String(node.attrs?.id ?? "");
      return [
        {
          ...node,
          attrs: {
            ...node.attrs,
            id: targetIds.get(currentId) ?? currentId,
          },
        },
      ];
    }
    if (node.type === "text" && tokenPattern && node.text) {
      return node.text.split(tokenPattern).flatMap<EditorNode>((part) => {
        const mention = byToken.get(part);
        if (!mention) return part ? [{ ...node, text: part }] : [];
        return [
          {
            type: "mention",
            attrs: {
              id: targetIds.get(mention.targetId) ?? mention.targetId,
              mentionId: randomUUID(),
              label: mention.label,
            },
          },
        ];
      });
    }
    return [
      {
        ...node,
        ...(node.content
          ? { content: node.content.flatMap((child) => visit(child)) }
          : {}),
      },
    ];
  }

  return parseEditorDocument(visit(document)[0]);
}

function stripFrontMatter(value: string) {
  if (!value.startsWith("---\n")) return { metadata: {}, body: value };
  const end = value.indexOf("\n---\n", 4);
  if (end < 0 || end > 20_000) return { metadata: {}, body: value };
  const metadata: Record<string, string> = {};
  for (const line of value.slice(4, end).split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLocaleLowerCase();
    const raw = line.slice(separator + 1).trim();
    metadata[key] = unquote(raw);
  }
  return { metadata, body: value.slice(end + 5) };
}

function extractHeader(value: string) {
  const lines = value.split("\n");
  while (lines[0] === "") lines.shift();
  let title: string | null = null;
  let created: string | null = null;
  let updated: string | null = null;
  let noteId: string | null = null;
  if (/^#\s+/.test(lines[0] ?? "")) {
    title = (lines.shift() ?? "").replace(/^#\s+/, "").trim();
    while (lines[0] === "") lines.shift();
    for (let index = 0; index < Math.min(lines.length, 4); index += 1) {
      const line = lines[index] ?? "";
      const match = /^(Created|Updated|Note ID):\s*(.+?)(?:  )?$/.exec(line);
      if (!match) break;
      if (match[1] === "Created") created = match[2] ?? null;
      if (match[1] === "Updated") updated = match[2] ?? null;
      if (match[1] === "Note ID") noteId = match[2] ?? null;
      lines.splice(index, 1);
      index -= 1;
    }
    while (lines[0] === "") lines.shift();
  }
  return { title, created, updated, noteId, body: lines.join("\n") };
}

function parseTags(value?: string) {
  if (!value) return [];
  const unwrapped =
    value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return [
    ...new Set(
      unwrapped
        .split(",")
        .map((tag) => unquote(tag.trim()).replaceAll(/\s+/g, " "))
        .filter((tag) => tag.length > 0 && tag.length <= 100),
    ),
  ].slice(0, 30);
}

function parseDate(value?: string | null) {
  if (!value || value.length > 100) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function boundedMetadata(
  value: string | undefined,
  fallback: string,
  maximum: number,
) {
  const result = value?.trim() || fallback;
  return result.slice(0, maximum);
}

function boundedTitle(value: string) {
  return (value.trim() || "Untitled Note").slice(0, 500);
}

function normalizeImportPath(value: string) {
  return value.normalize("NFC").replaceAll("\\", "/").slice(0, 1_000);
}

function filenameTitle(value: string) {
  const name = value.replaceAll("\\", "/").split("/").at(-1) ?? "";
  return name.replace(/\.md$/i, "").replaceAll(/[-_]+/g, " ");
}

function uuidOrNull(value?: string | null) {
  return value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
    ? value.toLowerCase()
    : null;
}

function unquote(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
    } catch {
      // Fall back to simple quote removal for hand-written front matter.
    }
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
