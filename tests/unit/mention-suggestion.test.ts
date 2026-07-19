import { afterEach, describe, expect, it, vi } from "vitest";

import { createMentionSuggestion } from "@/features/notes/mention-suggestion";
import type { MentionSuggestionItem } from "@/features/notes/types";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("mention suggestions", () => {
  it("forwards the query, current note, and cancellation signal", async () => {
    const responseItems: MentionSuggestionItem[] = [
      {
        kind: "note",
        id: "c0b1b28a-7462-4d6e-a475-c81c18dd4490",
        label: "Atlas",
        excerpt: "Project map",
        updatedAt: "2026-07-19T12:00:00.000Z",
        isSelf: false,
      },
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ items: responseItems }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const controller = new AbortController();
    const options = createMentionSuggestion(
      "e4c99ac5-d076-4b61-852f-cfb0d8baf614",
    );

    const items = await options.items?.({
      query: "Atlas",
      editor: {} as never,
      signal: controller.signal,
    });

    expect(items).toEqual(responseItems);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notes/suggestions?q=Atlas&currentNoteId=e4c99ac5-d076-4b61-852f-cfb0d8baf614",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("renders accessible states and commits a pointer selection", () => {
    const editorElement = document.createElement("div");
    editorElement.setAttribute("role", "textbox");
    document.body.append(editorElement);
    const command = vi.fn();
    const options = createMentionSuggestion(
      "e4c99ac5-d076-4b61-852f-cfb0d8baf614",
    );
    const renderer = options.render?.();
    const baseProps = {
      editor: { view: { dom: editorElement } },
      query: "Atlas",
      items: [] as MentionSuggestionItem[],
      command,
      loading: true,
      mount: (element: HTMLElement) => {
        document.body.append(element);
        return () => element.remove();
      },
    };

    renderer?.onStart?.(baseProps as never);
    expect(document.querySelector('[role="region"]')).toHaveAttribute(
      "aria-label",
      "Note link suggestions",
    );
    expect(document.querySelector('[role="status"]')).toHaveTextContent(
      "Searching notes…",
    );
    expect(editorElement).toHaveAttribute("aria-haspopup", "listbox");

    renderer?.onUpdate?.({
      ...baseProps,
      loading: false,
      items: [
        {
          kind: "note",
          id: "c0b1b28a-7462-4d6e-a475-c81c18dd4490",
          label: "Atlas",
          excerpt: "Project map",
          updatedAt: "2026-07-19T12:00:00.000Z",
          isSelf: true,
        },
      ],
    } as never);

    const option = document.querySelector<HTMLButtonElement>('[role="option"]');
    expect(option).toHaveAttribute("aria-selected", "true");
    expect(option).toHaveTextContent("Current note");
    option?.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    option?.click();
    expect(command).toHaveBeenCalledWith({
      id: "c0b1b28a-7462-4d6e-a475-c81c18dd4490",
      label: "Atlas",
      mentionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });

    renderer?.onExit?.(baseProps as never);
    expect(document.querySelector('[role="region"]')).toBeNull();
    expect(editorElement).not.toHaveAttribute("aria-controls");
    expect(editorElement).not.toHaveAttribute("aria-haspopup");
  });
});
