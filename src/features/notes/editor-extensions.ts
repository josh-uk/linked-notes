import { mergeAttributes } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import Mention from "@tiptap/extension-mention";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";

import { createMentionSuggestion } from "./mention-suggestion";
import type { MentionTarget } from "./types";

export function createEditorExtensions({
  placeholder = true,
  mention,
}: {
  placeholder?: boolean;
  mention?: {
    currentNoteId: string;
    targets: MentionTarget[];
    suggestions?: boolean;
  };
} = {}) {
  const targets = new Map(
    mention?.targets.map((target) => [target.id, target]) ?? [],
  );
  const durableMention = Mention.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        mentionId: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-mention-id"),
          renderHTML: (attributes) => ({
            "data-mention-id": attributes.mentionId,
          }),
        },
      };
    },
  }).configure({
    deleteTriggerWithBackspace: true,
    suggestion:
      mention?.suggestions !== false && mention?.currentNoteId
        ? createMentionSuggestion(mention.currentNoteId)
        : { items: () => [] },
    renderText: ({ node }) => mentionText(node.attrs, targets),
    renderHTML: ({ node, options }) => {
      const target = targets.get(String(node.attrs.id));
      // A freshly selected mention is not yet in the note's server-resolved map.
      // Missing is therefore an explicit state, never inferred from map absence.
      const state = target?.state ?? "active";
      const title = target?.title || String(node.attrs.label || "Missing note");
      return [
        "span",
        mergeAttributes(options.HTMLAttributes, {
          "data-type": "mention",
          "data-id": node.attrs.id,
          "data-mention-id": node.attrs.mentionId,
          "data-note-target": node.attrs.id,
          "data-state": state,
          class: `note-mention is-${state}`,
          role: "link",
          tabindex: "0",
          "aria-disabled": state === "missing" ? "true" : undefined,
          "aria-label": mentionAriaLabel(title, state),
        }),
        mentionText(node.attrs, targets),
      ];
    },
  });

  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: false,
    }),
    Link.configure({
      autolink: true,
      defaultProtocol: "https",
      openOnClick: false,
      protocols: ["http", "https", "mailto"],
      HTMLAttributes: {
        rel: "noopener noreferrer nofollow",
        target: "_blank",
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    durableMention,
    ...(placeholder
      ? [
          Placeholder.configure({
            placeholder: "Start writing, or type @ to connect a note…",
          }),
        ]
      : []),
  ];
}

function mentionText(
  attributes: Record<string, unknown>,
  targets: Map<string, MentionTarget>,
): string {
  const target = targets.get(String(attributes.id));
  const title = target?.title || String(attributes.label || "Missing note");
  if (target?.state === "trashed") return `@${title} · trashed`;
  if (target?.state === "archived") return `@${title} · archived`;
  if (target?.state === "missing") return `@${title} · missing`;
  return `@${title}`;
}

function mentionAriaLabel(
  title: string,
  state: MentionTarget["state"],
): string {
  if (state === "missing") return `Linked note ${title}; target is missing`;
  if (state === "trashed") return `Linked note ${title}; target is in trash`;
  if (state === "archived") return `Linked note ${title}; target is archived`;
  return `Open linked note ${title}`;
}
