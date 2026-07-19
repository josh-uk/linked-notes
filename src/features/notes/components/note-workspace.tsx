"use client";

import { FilePlus2, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ApiError,
  AttachmentFilter,
  BulkNoteAction,
  NoteDetail,
  NoteLifecycleAction,
  NoteSort,
  NoteSummary,
  NotesPage,
  NotesView,
  OrganizationResponse,
  SearchPage,
  SortDirection,
} from "../types";
import { AppSidebar } from "./app-sidebar";
import { NoteEditor, type NoteEditorHandle } from "./note-editor";
import { NoteList } from "./note-list";
import { OrganizationDialog } from "./organization-dialog";

type MobileView = "sidebar" | "list" | "editor";
type OrganizationSection = "folders" | "tags" | "settings";

export function NoteWorkspace() {
  const [view, setView] = useState<NotesView>("all");
  const [mobileView, setMobileView] = useState<MobileView>("list");
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<NoteDetail | null>(null);
  const [organization, setOrganization] = useState<OrganizationResponse | null>(
    null,
  );
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [currentTagId, setCurrentTagId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<NoteSort>("updated");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const [attachments, setAttachments] = useState<AttachmentFilter>("any");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [organizationOpen, setOrganizationOpen] = useState(false);
  const [organizationSection, setOrganizationSection] =
    useState<OrganizationSection>("folders");
  const editorRef = useRef<NoteEditorHandle>(null);
  const requestRef = useRef<AbortController | null>(null);
  const selectedNoteRef = useRef<NoteDetail | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query.trim()), 180);
    return () => clearTimeout(timeout);
  }, [query]);

  const fetchOrganization = useCallback(async () => {
    try {
      const response = await fetch("/api/organization", { cache: "no-store" });
      const payload = (await response.json()) as
        OrganizationResponse | ApiError;
      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload
            ? payload.error.message
            : "Organization data could not be loaded",
        );
      }
      setOrganization(payload);
      return payload;
    } catch (error) {
      setListError(
        error instanceof Error
          ? error.message
          : "Organization data could not be loaded",
      );
      return null;
    }
  }, []);

  const fetchNote = useCallback(async (id: string) => {
    setEditorLoading(true);
    try {
      const response = await fetch(`/api/notes/${id}`, { cache: "no-store" });
      const payload = (await response.json()) as NoteDetail | ApiError;
      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload
            ? payload.error.message
            : "The note could not be opened",
        );
      }
      selectedNoteRef.current = payload;
      setSelectedNote(payload);
    } catch (error) {
      setListError(
        error instanceof Error ? error.message : "The note could not be opened",
      );
      selectedNoteRef.current = null;
      setSelectedNote(null);
    } finally {
      setEditorLoading(false);
    }
  }, []);

  const fetchPage = useCallback(
    async ({
      cursor,
      append = false,
      selectFirst = false,
    }: { cursor?: string; append?: boolean; selectFirst?: boolean } = {}) => {
      requestRef.current?.abort();
      const request = new AbortController();
      requestRef.current = request;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setListError(null);
      try {
        const search = new URLSearchParams({
          view,
          limit: "40",
          attachments,
          sort:
            debouncedQuery && sort === "relevance"
              ? "relevance"
              : sort === "relevance"
                ? "updated"
                : sort,
          direction,
        });
        if (currentFolderId) search.set("folderId", currentFolderId);
        if (currentTagId) search.set("tagIds", currentTagId);
        if (cursor) {
          search.set(debouncedQuery ? "offset" : "cursor", cursor);
        }
        if (debouncedQuery) search.set("q", debouncedQuery);
        const endpoint = debouncedQuery ? "/api/notes/search" : "/api/notes";
        const response = await fetch(`${endpoint}?${search}`, {
          cache: "no-store",
          signal: request.signal,
        });
        const payload = (await response.json()) as
          NotesPage | SearchPage | ApiError;
        if (!response.ok || "error" in payload) {
          throw new Error(
            "error" in payload
              ? payload.error.message
              : "Notes could not be loaded",
          );
        }
        setNotes((current) =>
          append ? [...current, ...payload.items] : payload.items,
        );
        setNextCursor(
          "nextOffset" in payload
            ? (payload.nextOffset?.toString() ?? null)
            : payload.nextCursor,
        );
        if (!append && selectFirst && payload.items.length > 0) {
          void fetchNote(payload.items[0]!.id);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setListError(
          error instanceof Error ? error.message : "Notes could not be loaded",
        );
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [
      attachments,
      currentFolderId,
      currentTagId,
      debouncedQuery,
      direction,
      fetchNote,
      sort,
      view,
    ],
  );

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void fetchOrganization();
    });
    return () => {
      active = false;
    };
  }, [fetchOrganization]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        void fetchPage({ selectFirst: selectedNoteRef.current === null });
      }
    });
    return () => {
      active = false;
      requestRef.current?.abort();
    };
  }, [fetchPage]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void createNote();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document
          .querySelector<HTMLInputElement>(
            '[aria-label="Search note titles and bodies"]',
          )
          ?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  async function createNote() {
    if (creating || loading || editorLoading || view !== "all") return;
    const flushed =
      (await editorRef.current?.flush().catch(() => false)) ?? true;
    if (!flushed) return;
    setCreating(true);
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(currentFolderId ? { folderId: currentFolderId } : {}),
          ...(currentTagId ? { tagIds: [currentTagId] } : {}),
        }),
      });
      const payload = (await response.json()) as NoteDetail | ApiError;
      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload
            ? payload.error.message
            : "A new note could not be created",
        );
      }
      selectedNoteRef.current = payload;
      setSelectedNote(payload);
      setNotes((current) => [
        toSummary(payload),
        ...current.filter((note) => note.id !== payload.id),
      ]);
      setMobileView("editor");
      void fetchOrganization();
    } catch (error) {
      setListError(
        error instanceof Error
          ? error.message
          : "A new note could not be created",
      );
    } finally {
      setCreating(false);
    }
  }

  async function selectNote(id: string) {
    if (id === selectedNoteRef.current?.id) {
      setMobileView("editor");
      return;
    }
    const flushed = (await editorRef.current?.flush()) ?? true;
    if (!flushed) return;
    await fetchNote(id);
    setMobileView("editor");
  }

  async function changeView(nextView: NotesView) {
    const flushed = (await editorRef.current?.flush()) ?? true;
    if (!flushed) return;
    setCurrentFolderId(null);
    setCurrentTagId(null);
    selectedNoteRef.current = null;
    setSelectedNote(null);
    setView(nextView);
    setMobileView("list");
  }

  async function chooseFolder(folderId: string) {
    if (!((await editorRef.current?.flush()) ?? true)) return;
    setView("all");
    setCurrentTagId(null);
    setCurrentFolderId(folderId);
    setMobileView("list");
  }

  async function chooseTag(tagId: string) {
    if (!((await editorRef.current?.flush()) ?? true)) return;
    setView("all");
    setCurrentFolderId(null);
    setCurrentTagId(tagId);
    setMobileView("list");
  }

  async function runBulk(
    action: BulkNoteAction,
    selected: NoteSummary[],
    options: { folderId?: string | null; tagIds?: string[] } = {},
  ) {
    const response = await fetch("/api/notes/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        notes: selected.map(({ id, optimisticVersion }) => ({
          id,
          expectedVersion: optimisticVersion,
        })),
        ...options,
      }),
    });
    const payload = (await response.json()) as
      { items: NoteSummary[] } | ApiError;
    if (!response.ok || "error" in payload) {
      throw new Error(
        "error" in payload ? payload.error.message : "The bulk action failed",
      );
    }
    await fetchOrganization();
    const selectedCurrent = selected.some(
      ({ id }) => id === selectedNoteRef.current?.id,
    );
    if ((action === "move" || action === "tag") && selectedCurrent) {
      await fetchNote(selectedNoteRef.current!.id);
      await fetchPage();
    } else {
      selectedNoteRef.current = null;
      setSelectedNote(null);
      await fetchPage({ selectFirst: true });
    }
    return true;
  }

  function handleSaved(note: NoteDetail) {
    selectedNoteRef.current = note;
    setSelectedNote(note);
    setNotes((current) =>
      current.map((item) => (item.id === note.id ? toSummary(note) : item)),
    );
    void fetchOrganization();
  }

  function handleLifecycle(note: NoteDetail, action: NoteLifecycleAction) {
    if (action === "pin" || action === "unpin") {
      handleSaved(note);
      void fetchPage();
      return;
    }
    selectedNoteRef.current = null;
    setSelectedNote(null);
    setMobileView("list");
    void fetchOrganization();
    void fetchPage({ selectFirst: true });
  }

  function handleDeleted() {
    selectedNoteRef.current = null;
    setSelectedNote(null);
    setMobileView("list");
    void fetchOrganization();
    void fetchPage({ selectFirst: true });
  }

  function openOrganization(section: OrganizationSection) {
    setOrganizationSection(section);
    setOrganizationOpen(true);
  }

  return (
    <main className="workspace-shell" data-mobile-view={mobileView}>
      <AppSidebar
        currentView={view}
        organization={organization}
        currentFolderId={currentFolderId}
        currentTagId={currentTagId}
        onViewChange={(nextView) => void changeView(nextView)}
        onFolderChange={(folderId) => void chooseFolder(folderId)}
        onTagChange={(tagId) => void chooseTag(tagId)}
        onManageOrganization={openOrganization}
        onOpenNotes={() => setMobileView("list")}
      />
      <NoteList
        notes={notes}
        view={view}
        organization={organization}
        currentFolderId={currentFolderId}
        currentTagId={currentTagId}
        query={query}
        sort={sort}
        direction={direction}
        attachments={attachments}
        activeNoteId={selectedNote?.id ?? null}
        loading={loading}
        searching={query.trim() !== debouncedQuery}
        loadingMore={loadingMore}
        createDisabled={loading || editorLoading || creating}
        nextCursor={nextCursor}
        error={listError}
        onSelect={(id) => void selectNote(id)}
        onCreate={() => void createNote()}
        onQueryChange={(value) => {
          setQuery(value);
          if (value.trim() && sort !== "relevance") setSort("relevance");
          if (!value.trim() && sort === "relevance") setSort("updated");
        }}
        onSortChange={setSort}
        onDirectionChange={setDirection}
        onAttachmentsChange={setAttachments}
        onClearScope={() => {
          setCurrentFolderId(null);
          setCurrentTagId(null);
          setAttachments("any");
        }}
        onBulk={runBulk}
        onLoadMore={() =>
          void fetchPage({ cursor: nextCursor ?? undefined, append: true })
        }
        onOpenSidebar={() => setMobileView("sidebar")}
      />

      {editorLoading || creating ? (
        <section className="editor-empty" aria-busy="true">
          <LoaderCircle className="spin" size={24} aria-hidden="true" />
          <span>{creating ? "Creating note…" : "Opening note…"}</span>
        </section>
      ) : selectedNote ? (
        <NoteEditor
          key={selectedNote.id}
          ref={editorRef}
          note={selectedNote}
          organization={organization}
          onSaved={handleSaved}
          onLifecycle={handleLifecycle}
          onDeleted={handleDeleted}
          onOpenLinkedNote={(noteId) => void selectNote(noteId)}
          onBack={() => setMobileView("list")}
        />
      ) : (
        <section className="editor-empty">
          <div className="empty-editor-mark" aria-hidden="true">
            <FilePlus2 size={25} />
          </div>
          <h2>
            {view === "trash"
              ? "Select a note to restore or delete"
              : view === "archive"
                ? "Select an archived note"
                : "Select a note to begin"}
          </h2>
          <p>
            {view === "trash"
              ? "Trashed notes remain recoverable until you deliberately delete them."
              : "Your writing stays on this machine and saves automatically."}
          </p>
          {view === "all" ? (
            <button
              type="button"
              className="new-note-button large"
              disabled={loading || editorLoading || creating}
              onClick={() => void createNote()}
            >
              Create a new note
            </button>
          ) : null}
        </section>
      )}

      <OrganizationDialog
        open={organizationOpen}
        initialSection={organizationSection}
        organization={organization}
        onClose={() => setOrganizationOpen(false)}
        beforeRestore={async () => (await editorRef.current?.flush()) ?? true}
        onWorkspaceRestored={() => window.location.reload()}
        onChanged={async () => {
          const nextOrganization = await fetchOrganization();
          const removedCurrentFolder = Boolean(
            currentFolderId &&
            !nextOrganization?.folders.some(({ id }) => id === currentFolderId),
          );
          const removedCurrentTag = Boolean(
            currentTagId &&
            !nextOrganization?.tags.some(({ id }) => id === currentTagId),
          );
          if (removedCurrentFolder) setCurrentFolderId(null);
          if (removedCurrentTag) setCurrentTagId(null);
          if (!removedCurrentFolder && !removedCurrentTag) await fetchPage();
        }}
      />
    </main>
  );
}

function toSummary(note: NoteDetail): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    excerpt: note.excerpt,
    optimisticVersion: note.optimisticVersion,
    folder: note.folder,
    tags: note.tags,
    attachmentCount: note.attachmentCount,
    pinnedAt: note.pinnedAt,
    archivedAt: note.archivedAt,
    trashedAt: note.trashedAt,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}
