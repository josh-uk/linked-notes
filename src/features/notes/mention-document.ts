import type { EditorDocument, EditorNode } from "./types";

export type ExtractedMention = {
  targetId: string;
  mentionId: string;
  fallbackLabel: string;
  context: string;
};

type MentionOffset = Omit<ExtractedMention, "context"> & { offset: number };

const blockNodes = new Set([
  "paragraph",
  "heading",
  "listItem",
  "taskItem",
  "blockquote",
  "codeBlock",
]);

export function extractMentions(document: EditorDocument): ExtractedMention[] {
  let text = "";
  const mentions: MentionOffset[] = [];

  function append(value: string) {
    text += value;
  }

  function visit(node: EditorNode) {
    if (node.type === "text") {
      append(node.text ?? "");
      return;
    }

    if (node.type === "mention") {
      const targetId = String(node.attrs?.id ?? "");
      const mentionId = String(node.attrs?.mentionId ?? "");
      const fallbackLabel = String(node.attrs?.label ?? "Untitled Note");
      mentions.push({
        targetId,
        mentionId,
        fallbackLabel,
        offset: text.length,
      });
      append(`@${fallbackLabel}`);
      return;
    }

    for (const child of node.content ?? []) visit(child);
    if (blockNodes.has(node.type)) append("\n");
  }

  visit(document);

  return mentions.map(({ offset, ...mention }) => ({
    ...mention,
    context: contextAround(text, offset),
  }));
}

function contextAround(text: string, offset: number): string {
  const start = Math.max(0, offset - 110);
  const end = Math.min(text.length, offset + 190);
  let context = text.slice(start, end).replaceAll(/\s+/g, " ").trim();
  if (start > 0) context = `…${context}`;
  if (end < text.length) context = `${context}…`;
  return context.slice(0, 500);
}
