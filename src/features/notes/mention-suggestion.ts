import type {
  SuggestionKeyDownProps,
  SuggestionOptions,
  SuggestionProps,
} from "@tiptap/suggestion";

import type {
  ApiError,
  MentionSuggestion,
  MentionSuggestionItem,
} from "./types";

export type MentionSelection = {
  id: string | null;
  label?: string | null;
  mentionId?: string;
};

export function createMentionSuggestion(
  currentNoteId: string,
): Omit<SuggestionOptions<MentionSuggestionItem, MentionSelection>, "editor"> {
  return {
    char: "@",
    allowSpaces: false,
    minQueryLength: 0,
    debounce: 120,
    items: async ({ query, signal }) => {
      try {
        const search = new URLSearchParams({
          q: query,
          currentNoteId,
        });
        const response = await fetch(`/api/notes/suggestions?${search}`, {
          cache: "no-store",
          signal,
        });
        const payload = (await response.json()) as
          { items: MentionSuggestion[] } | ApiError;
        if (!response.ok || "error" in payload) {
          return [
            {
              kind: "error" as const,
              message:
                "error" in payload
                  ? payload.error.message
                  : "Notes could not be searched",
            },
          ];
        }
        return payload.items;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        return [
          {
            kind: "error" as const,
            message: "Notes could not be searched",
          },
        ];
      }
    },
    render: createSuggestionRenderer,
  };
}

function createSuggestionRenderer() {
  let element: HTMLDivElement | null = null;
  let unmount: (() => void) | null = null;
  let currentProps: SuggestionProps<
    MentionSuggestionItem,
    MentionSelection
  > | null = null;
  let selectedIndex = 0;
  let lastQuery = "";

  function noteItems(): MentionSuggestion[] {
    return (
      currentProps?.items.filter(
        (item): item is MentionSuggestion => item.kind === "note",
      ) ?? []
    );
  }

  function select(item: MentionSuggestion) {
    currentProps?.command({
      id: item.id,
      label: item.label,
      mentionId: crypto.randomUUID(),
    });
  }

  function setEditorPopupState(expanded: boolean) {
    const editorElement = currentProps?.editor.view.dom;
    if (!editorElement) return;
    if (expanded && element) {
      editorElement.setAttribute("aria-controls", element.id);
      editorElement.setAttribute("aria-haspopup", "listbox");
      return;
    }
    editorElement.removeAttribute("aria-controls");
    editorElement.removeAttribute("aria-haspopup");
    editorElement.removeAttribute("aria-activedescendant");
  }

  function syncSelectedOption() {
    if (!element || !currentProps) return;
    const options = element.querySelectorAll<HTMLElement>("[role='option']");
    options.forEach((option, index) => {
      option.setAttribute("aria-selected", String(index === selectedIndex));
    });
    currentProps.editor.view.dom.setAttribute(
      "aria-activedescendant",
      `${element.id}-option-${selectedIndex}`,
    );
  }

  function renderPopup() {
    if (!element || !currentProps) return;
    element.replaceChildren();
    const editorElement = currentProps.editor.view.dom;

    if (currentProps.loading) {
      element.setAttribute("aria-live", "polite");
      const state = document.createElement("div");
      state.className = "mention-suggestion-state";
      state.setAttribute("role", "status");
      state.textContent = "Searching notes…";
      element.append(state);
      editorElement.removeAttribute("aria-activedescendant");
      return;
    }

    const error = currentProps.items.find((item) => item.kind === "error");
    if (error?.kind === "error") {
      const state = document.createElement("div");
      state.className = "mention-suggestion-state error-state";
      state.setAttribute("role", "alert");
      state.textContent = error.message;
      element.append(state);
      editorElement.removeAttribute("aria-activedescendant");
      return;
    }

    const items = noteItems();
    if (items.length === 0) {
      const state = document.createElement("div");
      state.className = "mention-suggestion-state";
      state.setAttribute("role", "status");
      state.textContent = "No matching notes";
      element.append(state);
      editorElement.removeAttribute("aria-activedescendant");
      return;
    }

    selectedIndex = Math.max(0, Math.min(selectedIndex, items.length - 1));
    element.removeAttribute("aria-live");
    const list = document.createElement("div");
    list.id = `${element.id}-list`;
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Link a note");

    items.forEach((item, index) => {
      const option = document.createElement("button");
      option.id = `${element!.id}-option-${index}`;
      option.type = "button";
      option.className = "mention-suggestion-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === selectedIndex));

      const titleRow = document.createElement("span");
      titleRow.className = "mention-suggestion-title";
      const title = document.createElement("strong");
      title.textContent = item.label;
      titleRow.append(title);
      if (item.isSelf) {
        const badge = document.createElement("small");
        badge.textContent = "Current note";
        titleRow.append(badge);
      }
      const excerpt = document.createElement("span");
      excerpt.className = "mention-suggestion-excerpt";
      excerpt.textContent = item.excerpt;
      option.append(titleRow, excerpt);
      option.addEventListener("pointerenter", () => {
        selectedIndex = index;
        syncSelectedOption();
      });
      option.addEventListener("pointerdown", (event) => {
        event.preventDefault();
      });
      option.addEventListener("click", () => {
        select(item);
      });
      list.append(option);
    });
    element.append(list);

    editorElement.setAttribute(
      "aria-activedescendant",
      `${element.id}-option-${selectedIndex}`,
    );
  }

  return {
    onStart(props: SuggestionProps<MentionSuggestionItem, MentionSelection>) {
      currentProps = props;
      lastQuery = props.query;
      selectedIndex = 0;
      element = document.createElement("div");
      element.id = `linked-note-suggestions-${crypto.randomUUID()}`;
      element.className = "mention-suggestions";
      element.setAttribute("role", "region");
      element.setAttribute("aria-label", "Note link suggestions");
      unmount = props.mount(element);
      setEditorPopupState(true);
      renderPopup();
    },
    onUpdate(props: SuggestionProps<MentionSuggestionItem, MentionSelection>) {
      currentProps = props;
      if (lastQuery !== props.query) {
        lastQuery = props.query;
        selectedIndex = 0;
      }
      renderPopup();
    },
    onKeyDown({ event }: SuggestionKeyDownProps) {
      const items = noteItems();
      if (event.key === "ArrowDown") {
        if (items.length > 0)
          selectedIndex = (selectedIndex + 1) % items.length;
        renderPopup();
        return true;
      }
      if (event.key === "ArrowUp") {
        if (items.length > 0)
          selectedIndex = (selectedIndex - 1 + items.length) % items.length;
        renderPopup();
        return true;
      }
      if (event.key === "Enter") {
        const selected = items[selectedIndex];
        if (selected) select(selected);
        return true;
      }
      return false;
    },
    onExit() {
      setEditorPopupState(false);
      unmount?.();
      unmount = null;
      element = null;
      currentProps = null;
    },
  };
}
