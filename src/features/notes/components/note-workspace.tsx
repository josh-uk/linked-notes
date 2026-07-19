"use client";

import { FilePlus2, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ApiError,
  NoteDetail,
  NoteLifecycleAction,
  NoteSummary,
  NotesPage,
  NotesView,
} from "../types";
import { AppSidebar } from "./app-sidebar";
import { NoteEditor, type NoteEditorHandle } from "./note-editor";
import { NoteList } from "./note-list";

type MobileView = "sidebar" | "list" | "editor";

export function NoteWorkspace() {
  const [view, setView] = useState<NotesView>("all");
  const [mobileView, setMobileView] = useState<MobileView>("list");
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<NoteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const editorRef = useRef<NoteEditorHandle>(null);
  const requestRef = useRef<AbortController | null>(null);

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
      setSelectedNote(payload);
    } catch (error) {
      setListError(
        error instanceof Error ? error.message : "The note could not be opened",
      );
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
        const search = new URLSearchParams({ view, limit: "40" });
        if (cursor) search.set("cursor", cursor);
        const response = await fetch(`/api/notes?${search}`, {
          cache: "no-store",
          signal: request.signal,
        });
        const payload = (await response.json()) as NotesPage | ApiError;
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
        setNextCursor(payload.nextCursor);
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
    [fetchNote, view],
  );

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void fetchPage({ selectFirst: true });
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
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  async function createNote() {
    const flushed =
      (await editorRef.current?.flush().catch(() => false)) ?? true;
    if (creating || !flushed) return;
    setCreating(true);
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as NoteDetail | ApiError;
      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload
            ? payload.error.message
            : "A new note could not be created",
        );
      }
      setSelectedNote(payload);
      setNotes((current) => [
        toSummary(payload),
        ...current.filter((note) => note.id !== payload.id),
      ]);
      setMobileView("editor");
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
    if (id === selectedNote?.id) {
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
    setSelectedNote(null);
    setView(nextView);
    setMobileView("list");
  }

  function handleSaved(note: NoteDetail) {
    setSelectedNote(note);
    setNotes((current) =>
      current.map((item) => (item.id === note.id ? toSummary(note) : item)),
    );
  }

  function handleLifecycle(note: NoteDetail, action: NoteLifecycleAction) {
    if (action === "pin" || action === "unpin") {
      handleSaved(note);
      void fetchPage();
      return;
    }
    setSelectedNote(null);
    setMobileView("list");
    void fetchPage({ selectFirst: true });
  }

  return (
    <main className="workspace-shell" data-mobile-view={mobileView}>
      <AppSidebar
        currentView={view}
        onViewChange={(nextView) => void changeView(nextView)}
        onOpenNotes={() => setMobileView("list")}
      />
      <NoteList
        notes={notes}
        view={view}
        activeNoteId={selectedNote?.id ?? null}
        loading={loading}
        loadingMore={loadingMore}
        nextCursor={nextCursor}
        error={listError}
        onSelect={(id) => void selectNote(id)}
        onCreate={() => void createNote()}
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
          ref={editorRef}
          note={selectedNote}
          onSaved={handleSaved}
          onLifecycle={handleLifecycle}
          onBack={() => setMobileView("list")}
        />
      ) : (
        <section className="editor-empty">
          <div className="empty-editor-mark" aria-hidden="true">
            <FilePlus2 size={25} />
          </div>
          <h2>
            {view === "trash"
              ? "Select a note to restore"
              : "Select a note to begin"}
          </h2>
          <p>
            {view === "trash"
              ? "Trashed notes remain recoverable until you deliberately delete them in a later phase."
              : "Your writing stays on this machine and saves automatically."}
          </p>
          {view !== "trash" ? (
            <button
              type="button"
              className="new-note-button large"
              onClick={() => void createNote()}
            >
              Create a new note
            </button>
          ) : null}
        </section>
      )}
    </main>
  );
}

function toSummary(note: NoteDetail): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    excerpt: note.excerpt,
    optimisticVersion: note.optimisticVersion,
    pinnedAt: note.pinnedAt,
    archivedAt: note.archivedAt,
    trashedAt: note.trashedAt,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}
