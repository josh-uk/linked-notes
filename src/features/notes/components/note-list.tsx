"use client";

import {
  Archive,
  CheckSquare2,
  ChevronLeft,
  LoaderCircle,
  Menu,
  Pin,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { Fragment, useRef, useState } from "react";

import type {
  AttachmentFilter,
  BulkNoteAction,
  NoteSort,
  NoteSummary,
  NotesView,
  OrganizationResponse,
  SortDirection,
} from "../types";

type BulkOptions = { folderId?: string | null; tagIds?: string[] };

type NoteListProps = {
  notes: NoteSummary[];
  view: NotesView;
  organization: OrganizationResponse | null;
  currentFolderId: string | null;
  currentTagId: string | null;
  query: string;
  sort: NoteSort;
  direction: SortDirection;
  attachments: AttachmentFilter;
  activeNoteId: string | null;
  loading: boolean;
  searching: boolean;
  loadingMore: boolean;
  createDisabled: boolean;
  nextCursor: string | null;
  error: string | null;
  onRetry: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onQueryChange: (value: string) => void;
  onSortChange: (sort: NoteSort) => void;
  onDirectionChange: (direction: SortDirection) => void;
  onAttachmentsChange: (filter: AttachmentFilter) => void;
  onClearScope: () => void;
  onBulk: (
    action: BulkNoteAction,
    notes: NoteSummary[],
    options?: BulkOptions,
  ) => Promise<boolean>;
  onLoadMore: () => void;
  onOpenSidebar: () => void;
};

const viewTitles: Record<NotesView, string> = {
  all: "All notes",
  pinned: "Pinned",
  archive: "Archive",
  trash: "Trash",
};

export function NoteList({
  notes,
  view,
  organization,
  currentFolderId,
  currentTagId,
  query,
  sort,
  direction,
  attachments,
  activeNoteId,
  loading,
  searching,
  loadingMore,
  createDisabled,
  nextCursor,
  error,
  onRetry,
  onSelect,
  onCreate,
  onQueryChange,
  onSortChange,
  onDirectionChange,
  onAttachmentsChange,
  onClearScope,
  onBulk,
  onLoadMore,
  onOpenSidebar,
}: NoteListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [moveFolderId, setMoveFolderId] = useState("");
  const [bulkTagId, setBulkTagId] = useState("");
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const title = currentFolderId
    ? (organization?.folders.find(({ id }) => id === currentFolderId)?.name ??
      "Folder")
    : currentTagId
      ? `#${organization?.tags.find(({ id }) => id === currentTagId)?.displayName ?? "Tag"}`
      : viewTitles[view];

  function moveSelection(directionValue: 1 | -1) {
    if (notes.length === 0 || selectionMode) return;
    const currentIndex = notes.findIndex((note) => note.id === activeNoteId);
    const nextIndex = Math.max(
      0,
      Math.min(notes.length - 1, currentIndex + directionValue),
    );
    onSelect(notes[nextIndex]?.id ?? notes[0]!.id);
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-note-id="${notes[nextIndex]?.id}"]`)
        ?.focus();
    });
  }

  async function runBulk(action: BulkNoteAction, options?: BulkOptions) {
    const selected = notes.filter(({ id }) => selectedIds.includes(id));
    if (selected.length === 0) return;
    setBulkPending(true);
    setBulkError(null);
    try {
      const success = await onBulk(action, selected, options);
      if (success) {
        setSelectedIds([]);
        setSelectionMode(false);
      }
    } catch (actionError) {
      setBulkError(
        actionError instanceof Error
          ? actionError.message
          : "The bulk action failed",
      );
    } finally {
      setBulkPending(false);
    }
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
          <h1 id="notes-view-title">{title}</h1>
        </div>
        <button
          type="button"
          className="new-note-button"
          aria-label="Create a new note"
          title="New note (⌘N)"
          disabled={createDisabled || view !== "all"}
          onClick={onCreate}
        >
          <Plus size={18} aria-hidden="true" />
          <span>New</span>
        </button>
      </header>

      <div className="search-control">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          aria-label="Search note titles and bodies"
          placeholder="Search notes"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) onQueryChange("");
          }}
        />
        {searching ? (
          <LoaderCircle className="spin" size={15} aria-label="Searching" />
        ) : query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onQueryChange("")}
          >
            <X size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="list-controls" aria-label="Note list controls">
        <select
          aria-label="Sort notes by"
          value={sort}
          onChange={(event) => onSortChange(event.target.value as NoteSort)}
        >
          {query ? <option value="relevance">Relevance</option> : null}
          <option value="updated">Updated</option>
          <option value="created">Created</option>
          <option value="title">Title</option>
        </select>
        <select
          aria-label="Sort direction"
          value={direction}
          disabled={sort === "relevance"}
          onChange={(event) =>
            onDirectionChange(event.target.value as SortDirection)
          }
        >
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
        <select
          aria-label="Attachment filter"
          value={attachments}
          onChange={(event) =>
            onAttachmentsChange(event.target.value as AttachmentFilter)
          }
        >
          <option value="any">Any files</option>
          <option value="with">Has files</option>
          <option value="without">No files</option>
        </select>
        <button
          type="button"
          data-active={selectionMode || undefined}
          onClick={() => {
            setSelectionMode((current) => !current);
            setSelectedIds([]);
            setBulkError(null);
          }}
        >
          <CheckSquare2 size={14} aria-hidden="true" />
          Select
        </button>
      </div>

      {currentFolderId || currentTagId || attachments !== "any" ? (
        <div className="active-filter">
          <span>Filtered view</span>
          <button type="button" onClick={onClearScope}>
            Clear filters
          </button>
        </div>
      ) : null}

      {selectionMode ? (
        <div className="bulk-toolbar" aria-label="Bulk note actions">
          <label>
            <input
              type="checkbox"
              checked={notes.length > 0 && selectedIds.length === notes.length}
              onChange={(event) =>
                setSelectedIds(
                  event.target.checked ? notes.map(({ id }) => id) : [],
                )
              }
            />
            {selectedIds.length} selected
          </label>
          <button
            type="button"
            disabled={bulkPending || selectedIds.length === 0}
            onClick={() => void runBulk("pin")}
          >
            <Pin size={14} aria-hidden="true" /> Pin
          </button>
          <button
            type="button"
            disabled={bulkPending || selectedIds.length === 0}
            onClick={() =>
              void runBulk(
                view === "archive" || view === "trash" ? "restore" : "archive",
              )
            }
          >
            <Archive size={14} aria-hidden="true" />
            {view === "archive" || view === "trash" ? "Restore" : "Archive"}
          </button>
          {view !== "trash" ? (
            <button
              type="button"
              disabled={bulkPending || selectedIds.length === 0}
              onClick={() => void runBulk("trash")}
            >
              <Trash2 size={14} aria-hidden="true" /> Trash
            </button>
          ) : null}
          <div className="bulk-select-action">
            <select
              aria-label="Bulk destination folder"
              value={moveFolderId}
              onChange={(event) => setMoveFolderId(event.target.value)}
            >
              <option value="">No folder</option>
              {organization?.folders.map((folder) => (
                <option value={folder.id} key={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={bulkPending || selectedIds.length === 0}
              onClick={() =>
                void runBulk("move", { folderId: moveFolderId || null })
              }
            >
              Move
            </button>
          </div>
          <div className="bulk-select-action">
            <select
              aria-label="Bulk tag"
              value={bulkTagId}
              onChange={(event) => setBulkTagId(event.target.value)}
            >
              <option value="">Choose tag</option>
              {organization?.tags.map((tag) => (
                <option value={tag.id} key={tag.id}>
                  {tag.displayName}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={bulkPending || selectedIds.length === 0 || !bulkTagId}
              onClick={() => void runBulk("tag", { tagIds: [bulkTagId] })}
            >
              <Tag size={14} aria-hidden="true" /> Add
            </button>
          </div>
          {bulkError ? <span role="alert">{bulkError}</span> : null}
        </div>
      ) : null}

      <div
        ref={listRef}
        className="note-list"
        role={
          selectionMode
            ? "list"
            : !loading && !error && notes.length > 0
              ? "listbox"
              : undefined
        }
        aria-label={`${title} list`}
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
            {query ? "Searching notes…" : "Loading notes…"}
          </div>
        ) : null}

        {!loading && error ? (
          <div className="list-state error-state" role="alert">
            <strong>Notes could not be loaded</strong>
            <span>{error}</span>
            <button type="button" onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : null}

        {!loading && !error && notes.length === 0 ? (
          <div className="list-state empty-list-state">
            <span className="empty-orbit" aria-hidden="true">
              <ChevronLeft size={18} />
            </span>
            <strong>
              {query
                ? "No matching notes"
                : view === "trash"
                  ? "Trash is empty"
                  : view === "archive"
                    ? "Archive is empty"
                    : "A quiet place to begin"}
            </strong>
            <span>
              {query
                ? "Try fewer words or clear a filter."
                : view === "trash"
                  ? "Notes moved here can be restored or deliberately deleted."
                  : "Create a note and start connecting ideas."}
            </span>
            {!query && view === "all" ? (
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
          ? notes.map((note) =>
              selectionMode ? (
                <label
                  className="note-selection-item"
                  role="listitem"
                  key={note.id}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(note.id)}
                    onChange={(event) =>
                      setSelectedIds((current) =>
                        event.target.checked
                          ? [...current, note.id]
                          : current.filter((id) => id !== note.id),
                      )
                    }
                  />
                  <NoteListContent note={note} />
                </label>
              ) : (
                <button
                  type="button"
                  role="option"
                  aria-selected={note.id === activeNoteId}
                  data-note-id={note.id}
                  key={note.id}
                  className="note-list-item"
                  onClick={() => onSelect(note.id)}
                >
                  <NoteListContent note={note} />
                </button>
              ),
            )
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

function NoteListContent({ note }: { note: NoteSummary }) {
  return (
    <>
      <span className="note-list-title">
        <strong>
          {note.titleHighlight ? (
            <HighlightedText value={note.titleHighlight} />
          ) : (
            note.title || "Untitled Note"
          )}
        </strong>
        {note.pinnedAt ? (
          <Pin size={13} fill="currentColor" aria-label="Pinned" />
        ) : null}
      </span>
      <span className="note-list-excerpt">
        {note.highlight ? (
          <HighlightedText value={note.highlight} />
        ) : (
          note.excerpt || "No additional text"
        )}
      </span>
      {note.folder || note.tags.length || note.attachmentCount ? (
        <span className="note-list-chips">
          {note.folder ? <small>{note.folder.name}</small> : null}
          {note.tags.slice(0, 2).map((tag) => (
            <small key={tag.id}>#{tag.displayName}</small>
          ))}
          {note.attachmentCount ? (
            <small>{note.attachmentCount} files</small>
          ) : null}
        </span>
      ) : null}
      <time dateTime={note.updatedAt}>{formatUpdated(note.updatedAt)}</time>
    </>
  );
}

function HighlightedText({ value }: { value: string }) {
  let highlighted = false;
  return value.split(/(<mark>|<\/mark>)/).map((part, index) => {
    if (part === "<mark>") {
      highlighted = true;
      return null;
    }
    if (part === "</mark>") {
      highlighted = false;
      return null;
    }
    return highlighted ? (
      <mark key={index}>{part}</mark>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    );
  });
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
