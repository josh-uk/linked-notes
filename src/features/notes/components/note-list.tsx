"use client";

import {
  ChevronLeft,
  LoaderCircle,
  Menu,
  Pin,
  Plus,
  Search,
} from "lucide-react";
import { useRef } from "react";

import type { NoteSummary, NotesView } from "../types";

type NoteListProps = {
  notes: NoteSummary[];
  view: NotesView;
  activeNoteId: string | null;
  loading: boolean;
  loadingMore: boolean;
  createDisabled: boolean;
  nextCursor: string | null;
  error: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onLoadMore: () => void;
  onOpenSidebar: () => void;
};

const viewTitles: Record<NotesView, string> = {
  all: "All notes",
  pinned: "Pinned",
  trash: "Trash",
};

export function NoteList({
  notes,
  view,
  activeNoteId,
  loading,
  loadingMore,
  createDisabled,
  nextCursor,
  error,
  onSelect,
  onCreate,
  onLoadMore,
  onOpenSidebar,
}: NoteListProps) {
  const listRef = useRef<HTMLDivElement>(null);

  function moveSelection(direction: 1 | -1) {
    if (notes.length === 0) return;
    const currentIndex = notes.findIndex((note) => note.id === activeNoteId);
    const nextIndex = Math.max(
      0,
      Math.min(notes.length - 1, currentIndex + direction),
    );
    onSelect(notes[nextIndex]?.id ?? notes[0]!.id);
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-note-id="${notes[nextIndex]?.id}"]`)
        ?.focus();
    });
  }

  return (
    <section className="note-list-pane" aria-labelledby="notes-view-title">
      <header className="list-header">
        <button
          type="button"
          className="icon-button mobile-only"
          aria-label="Open workspace navigation"
          title="Workspace navigation"
          onClick={onOpenSidebar}
        >
          <Menu size={19} aria-hidden="true" />
        </button>
        <div>
          <p className="list-kicker">Workspace</p>
          <h1 id="notes-view-title">{viewTitles[view]}</h1>
        </div>
        <button
          type="button"
          className="new-note-button"
          aria-label="Create a new note"
          title="New note (⌘N)"
          disabled={createDisabled}
          onClick={onCreate}
        >
          <Plus size={18} aria-hidden="true" />
          <span>New</span>
        </button>
      </header>

      <div
        className="search-preview"
        aria-disabled="true"
        title="Full-text search arrives in Phase 3"
      >
        <Search size={16} aria-hidden="true" />
        <span>Search arrives soon</span>
      </div>

      <div
        ref={listRef}
        className="note-list"
        role={!loading && !error && notes.length > 0 ? "listbox" : undefined}
        aria-label={`${viewTitles[view]} list`}
        aria-busy={loading}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            moveSelection(1);
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            moveSelection(-1);
          }
        }}
      >
        {loading ? (
          <div className="list-state" role="status">
            <LoaderCircle className="spin" size={20} aria-hidden="true" />
            Loading notes…
          </div>
        ) : null}

        {!loading && error ? (
          <div className="list-state error-state" role="alert">
            <strong>Notes could not be loaded</strong>
            <span>{error}</span>
          </div>
        ) : null}

        {!loading && !error && notes.length === 0 ? (
          <div className="list-state empty-list-state">
            <span className="empty-orbit" aria-hidden="true">
              <ChevronLeft size={18} />
            </span>
            <strong>
              {view === "trash" ? "Trash is empty" : "A quiet place to begin"}
            </strong>
            <span>
              {view === "trash"
                ? "Notes moved here can be restored."
                : "Create your first note and start connecting ideas."}
            </span>
            {view !== "trash" ? (
              <button
                type="button"
                className="secondary-button"
                disabled={createDisabled}
                onClick={onCreate}
              >
                Create a note
              </button>
            ) : null}
          </div>
        ) : null}

        {!loading && !error
          ? notes.map((note) => (
              <button
                type="button"
                role="option"
                aria-selected={note.id === activeNoteId}
                data-note-id={note.id}
                key={note.id}
                className="note-list-item"
                onClick={() => onSelect(note.id)}
              >
                <span className="note-list-title">
                  <strong>{note.title || "Untitled Note"}</strong>
                  {note.pinnedAt ? (
                    <Pin size={13} fill="currentColor" aria-label="Pinned" />
                  ) : null}
                </span>
                <span className="note-list-excerpt">
                  {note.excerpt || "No additional text"}
                </span>
                <time dateTime={note.updatedAt}>
                  {formatUpdated(note.updatedAt)}
                </time>
              </button>
            ))
          : null}
      </div>

      {nextCursor ? (
        <button
          type="button"
          className="load-more-button"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? (
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
          ) : null}
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </section>
  );
}

function formatUpdated(value: string): string {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}
