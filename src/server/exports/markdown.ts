import type {
  EditorDocument,
  EditorMark,
  EditorNode,
  MentionTarget,
} from "@/features/notes/types";

export type MarkdownExportNote = {
  id: string;
  title: string;
  content: EditorDocument;
  createdAt: Date;
  updatedAt: Date;
};

export type MarkdownExportAttachment = {
  originalName: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
};

export function renderNoteMarkdown(input: {
  note: MarkdownExportNote;
  mentionTargets: MentionTarget[];
  attachments: MarkdownExportAttachment[];
}) {
  const targets = new Map(
    input.mentionTargets.map((target) => [target.id, target]),
  );
  const content = renderBlocks(
    input.note.content.content ?? [],
    targets,
  ).trim();
  const sections = [
    `# ${escapeInline(input.note.title || "Untitled Note")}`,
    [
      `Created: ${input.note.createdAt.toISOString()}`,
      `Updated: ${input.note.updatedAt.toISOString()}`,
      `Note ID: ${input.note.id}`,
    ].join("  \n"),
    content,
  ].filter(Boolean);

  if (input.attachments.length > 0) {
    sections.push(
      [
        "## Attachments",
        ...input.attachments.map(
          (attachment) =>
            `- ${escapeInline(attachment.originalName)} (${attachment.mimeType}, ${formatBytes(attachment.byteSize)}, SHA-256 ${attachment.checksumSha256})`,
        ),
      ].join("\n"),
    );
  }

  return `${sections.join("\n\n")}\n`;
}

function renderBlocks(
  nodes: EditorNode[],
  targets: Map<string, MentionTarget>,
): string {
  return nodes
    .map((node) => renderBlock(node, targets))
    .filter(Boolean)
    .join("\n\n");
}

function renderBlock(
  node: EditorNode,
  targets: Map<string, MentionTarget>,
): string {
  if (node.type === "paragraph") return renderInlineChildren(node, targets);
  if (node.type === "heading") {
    const level = Number(node.attrs?.level ?? 1);
    return `${"#".repeat(Math.min(3, Math.max(1, level)))} ${renderInlineChildren(node, targets)}`;
  }
  if (node.type === "bulletList") return renderList(node, targets, "bullet", 0);
  if (node.type === "orderedList")
    return renderList(node, targets, "ordered", 0);
  if (node.type === "taskList") return renderList(node, targets, "task", 0);
  if (node.type === "blockquote") {
    const inner = renderBlocks(node.content ?? [], targets);
    return inner
      .split("\n")
      .map((line) => `> ${line}`.trimEnd())
      .join("\n");
  }
  if (node.type === "codeBlock") {
    const raw = rawText(node);
    const language =
      typeof node.attrs?.language === "string" ? node.attrs.language : "";
    const fence = "`".repeat(Math.max(3, longestRun(raw, "`") + 1));
    return `${fence}${language}\n${raw}\n${fence}`;
  }
  if (node.type === "horizontalRule") return "---";
  if (node.type === "hardBreak") return "  \n";
  return renderBlocks(node.content ?? [], targets);
}

function renderList(
  node: EditorNode,
  targets: Map<string, MentionTarget>,
  kind: "bullet" | "ordered" | "task",
  depth: number,
) {
  return (node.content ?? [])
    .map((item, index) => {
      const children = item.content ?? [];
      const first = children[0];
      const checked = item.attrs?.checked === true;
      const prefix =
        kind === "ordered"
          ? `${index + 1}. `
          : kind === "task"
            ? `- [${checked ? "x" : " "}] `
            : "- ";
      const indent = "  ".repeat(depth);
      const firstText = first
        ? first.type === "paragraph"
          ? renderInlineChildren(first, targets)
          : renderBlock(first, targets)
        : "";
      const firstLines = firstText.split("\n");
      const rendered = [
        `${indent}${prefix}${firstLines[0] ?? ""}`,
        ...firstLines.slice(1).map((line) => `${indent}  ${line}`),
      ];

      for (const child of children.slice(1)) {
        if (
          child.type === "bulletList" ||
          child.type === "orderedList" ||
          child.type === "taskList"
        ) {
          const childKind =
            child.type === "orderedList"
              ? "ordered"
              : child.type === "taskList"
                ? "task"
                : "bullet";
          rendered.push(renderList(child, targets, childKind, depth + 1));
        } else {
          rendered.push(
            renderBlock(child, targets)
              .split("\n")
              .map((line) => `${indent}  ${line}`)
              .join("\n"),
          );
        }
      }
      return rendered.join("\n");
    })
    .join("\n");
}

function renderInlineChildren(
  node: EditorNode,
  targets: Map<string, MentionTarget>,
) {
  return (node.content ?? [])
    .map((child) => renderInline(child, targets))
    .join("");
}

function renderInline(
  node: EditorNode,
  targets: Map<string, MentionTarget>,
): string {
  if (node.type === "hardBreak") return "  \n";
  if (node.type === "mention") {
    const targetId = String(node.attrs?.id ?? "");
    const target = targets.get(targetId);
    const label = target?.title || String(node.attrs?.label ?? "Untitled Note");
    const state = target?.state ?? "missing";
    const suffix = state === "active" ? "" : ` (${state})`;
    return `[@${escapeInline(label)}](linked-notes://note/${targetId})${suffix}`;
  }
  if (node.type !== "text") return renderInlineChildren(node, targets);

  const raw = node.text ?? "";
  const code = node.marks?.some(({ type }) => type === "code");
  let rendered = code ? inlineCode(raw) : escapeInline(raw);
  for (const mark of orderedMarks(node.marks ?? [])) {
    if (mark.type === "code") continue;
    if (mark.type === "bold") rendered = `**${rendered}**`;
    if (mark.type === "italic") rendered = `_${rendered}_`;
    if (mark.type === "strike") rendered = `~~${rendered}~~`;
    if (mark.type === "underline") rendered = `<u>${rendered}</u>`;
    if (mark.type === "link") {
      rendered = `[${rendered}](${escapeLink(String(mark.attrs?.href ?? ""))})`;
    }
  }
  return rendered;
}

function orderedMarks(marks: EditorMark[]) {
  const order = new Map([
    ["code", 0],
    ["bold", 1],
    ["italic", 2],
    ["strike", 3],
    ["underline", 4],
    ["link", 5],
  ]);
  return [...marks].sort(
    (left, right) =>
      (order.get(left.type) ?? 99) - (order.get(right.type) ?? 99),
  );
}

function rawText(node: EditorNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(rawText).join("");
}

function inlineCode(value: string) {
  const fence = "`".repeat(Math.max(1, longestRun(value, "`") + 1));
  const padding = value.startsWith(" ") || value.endsWith(" ") ? " " : "";
  return `${fence}${padding}${value}${padding}${fence}`;
}

function longestRun(value: string, character: string) {
  let longest = 0;
  let current = 0;
  for (const valueCharacter of value) {
    if (valueCharacter === character) {
      current += 1;
      longest = Math.max(longest, current);
    } else current = 0;
  }
  return longest;
}

function escapeInline(value: string) {
  return value.replaceAll(/([\\`*_[\]<>#])/g, "\\$1");
}

function escapeLink(value: string) {
  return value
    .replaceAll("\\", "%5C")
    .replaceAll("(", "%28")
    .replaceAll(")", "%29");
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}
