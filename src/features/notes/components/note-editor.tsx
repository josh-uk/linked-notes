"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Check,
  ChevronLeft,
  CloudOff,
  FolderClosed,
  LoaderCircle,
  Pin,
  PinOff,
  RotateCcw,
  Tags,
  Trash2,
} from "lucide-react";
import {
  forwardRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { createEditorExtensions } from "../editor-extensions";
import { sanitizePastedHtml } from "../paste-sanitizer";
import type {
  ApiError,
  EditorDocument,
  NoteDetail,
  NoteLifecycleAction,
  OrganizationResponse,
} from "../types";
import { EditorToolbar } from "./editor-toolbar";
import { BacklinksPanel } from "./backlinks-panel";
import { PermanentDeleteDialog } from "./permanent-delete-dialog";

type SaveState = "saved" | "unsaved" | "saving" | "error" | "conflict";

export type NoteEditorHandle = {
  flush: () => Promise<boolean>;
};

type RecoverableDraft = {
  title: string;
  content: EditorDocument;
};

type NoteEditorProps = {
  note: NoteDetail;
  organization: OrganizationResponse | null;
  onSaved: (note: NoteDetail) => void;
  onLifecycle: (note: NoteDetail, action: NoteLifecycleAction) => void;
  onDeleted: (noteId: string) => void;
  onOpenLinkedNote: (noteId: string) => void;
  onBack: () => void;
};

export const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(
  function NoteEditor(
    {
      note,
      organization,
      onSaved,
      onLifecycle,
      onDeleted,
      onOpenLinkedNote,
      onBack,
    },
    ref,
  ) {
    const [title, setTitle] = useState(note.title);
    const [saveState, setSaveState] = useState<SaveState>("saved");
    const [saveMessage, setSaveMessage] = useState<string | null>(null);
    const [conflict, setConflict] = useState<NoteDetail | null>(null);
    const [recoverableDraft, setRecoverableDraft] =
      useState<RecoverableDraft | null>(null);
    const [actionPending, setActionPending] = useState(false);
    const [confirmPermanentDelete, setConfirmPermanentDelete] = useState(false);

    const titleRef = useRef(note.title);
    const contentRef = useRef(note.content);
    const versionRef = useRef(note.optimisticVersion);
    const revisionRef = useRef(0);
    const savedRevisionRef = useRef(0);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const inFlightRef = useRef<Promise<boolean> | null>(null);
    const flushRef = useRef<() => Promise<boolean>>(async () => true);
    const activeNoteIdRef = useRef(note.id);
    const conflictRef = useRef<NoteDetail | null>(null);

    const markDirty = useCallback(
      (nextTitle: string, nextContent: EditorDocument) => {
        titleRef.current = nextTitle;
        contentRef.current = nextContent;
        revisionRef.current += 1;
        setSaveState("unsaved");
        setSaveMessage(null);
        persistDraft(
          activeNoteIdRef.current,
          versionRef.current,
          nextTitle,
          nextContent,
        );
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => void flushRef.current(), 700);
      },
      [],
    );

    const editor = useEditor({
      extensions: createEditorExtensions({
        mention: {
          currentNoteId: note.id,
          targets: note.mentionTargets,
        },
      }),
      content: note.content,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: "note-prose",
          role: "textbox",
          "aria-label": "Note content",
          "aria-multiline": "true",
          spellcheck: "true",
        },
        transformPastedHTML: sanitizePastedHtml,
      },
      onUpdate: ({ editor: currentEditor }) => {
        const content = currentEditor.getJSON() as EditorDocument;
        markDirty(titleRef.current, content);
      },
      onBlur: () => void flushRef.current(),
    });

    const saveOnce = useCallback(async () => {
      const startRevision = revisionRef.current;
      setSaveState("saving");
      setSaveMessage(null);

      try {
        const response = await fetch(`/api/notes/${note.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedVersion: versionRef.current,
            title: titleRef.current,
            content: contentRef.current,
          }),
          keepalive: true,
        });
        const payload = (await response.json()) as NoteDetail | ApiError;

        if (
          response.status === 409 &&
          "error" in payload &&
          payload.error.current
        ) {
          conflictRef.current = payload.error.current;
          setConflict(payload.error.current);
          setSaveState("conflict");
          setSaveMessage(
            "This note changed elsewhere. Your local draft is safe.",
          );
          return false;
        }
        if (!response.ok || "error" in payload) {
          throw new Error(
            "error" in payload
              ? payload.error.message
              : "The note could not be saved",
          );
        }

        versionRef.current = payload.optimisticVersion;
        savedRevisionRef.current = startRevision;
        onSaved(payload);

        if (revisionRef.current === startRevision) {
          setSaveState("saved");
          clearPersistedDraft(note.id);
        } else {
          setSaveState("unsaved");
        }
        return true;
      } catch (error) {
        setSaveState("error");
        setSaveMessage(
          error instanceof Error
            ? error.message
            : "The note could not be saved",
        );
        return false;
      }
    }, [note.id, onSaved]);

    const flush = useCallback(async () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (inFlightRef.current) return inFlightRef.current;

      const work = (async () => {
        while (
          savedRevisionRef.current < revisionRef.current &&
          !conflictRef.current
        ) {
          const saved = await saveOnce();
          if (!saved) return false;
        }
        return true;
      })();

      inFlightRef.current = work;
      try {
        return await work;
      } finally {
        inFlightRef.current = null;
      }
    }, [saveOnce]);

    useEffect(() => {
      flushRef.current = flush;
    }, [flush]);
    useImperativeHandle(ref, () => ({ flush }), [flush]);

    useEffect(() => {
      if (!editor || activeNoteIdRef.current === note.id) return;
      activeNoteIdRef.current = note.id;
      titleRef.current = note.title;
      contentRef.current = note.content;
      versionRef.current = note.optimisticVersion;
      revisionRef.current = 0;
      savedRevisionRef.current = 0;
      setTitle(note.title);
      conflictRef.current = null;
      setConflict(null);
      setRecoverableDraft(readPersistedDraft(note.id));
      setSaveState("saved");
      setSaveMessage(null);
      editor.commands.setContent(note.content, { emitUpdate: false });
    }, [editor, note.content, note.id, note.optimisticVersion, note.title]);

    useEffect(() => {
      let active = true;
      queueMicrotask(() => {
        if (active) setRecoverableDraft(readPersistedDraft(note.id));
      });
      return () => {
        active = false;
      };
    }, [note.id]);

    useEffect(() => {
      const onVisibility = () => {
        if (document.visibilityState === "hidden") void flushRef.current();
      };
      const onBeforeUnload = () => void flushRef.current();
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("beforeunload", onBeforeUnload);
      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("beforeunload", onBeforeUnload);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      };
    }, []);

    async function runLifecycle(action: NoteLifecycleAction) {
      if (!(await flush())) return;
      setActionPending(true);
      try {
        const response = await fetch(`/api/notes/${note.id}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, expectedVersion: versionRef.current }),
        });
        const payload = (await response.json()) as NoteDetail | ApiError;
        if (!response.ok || "error" in payload) {
          if ("error" in payload && payload.error.current) {
            conflictRef.current = payload.error.current;
            setConflict(payload.error.current);
            setSaveState("conflict");
            setSaveMessage(
              "This note changed elsewhere. Your local draft is safe.",
            );
            return;
          }
          throw new Error(
            "error" in payload
              ? payload.error.message
              : "The action could not be completed",
          );
        }
        versionRef.current = payload.optimisticVersion;
        onLifecycle(payload, action);
      } catch (error) {
        setSaveState("error");
        setSaveMessage(
          error instanceof Error
            ? error.message
            : "The action could not be completed",
        );
      } finally {
        setActionPending(false);
      }
    }

    async function updateOrganization(change: {
      folderId?: string | null;
      tagIds?: string[];
    }) {
      if (!(await flush())) return;
      setActionPending(true);
      setSaveMessage(null);
      try {
        const response = await fetch(`/api/notes/${note.id}/metadata`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedVersion: versionRef.current,
            ...change,
          }),
        });
        const payload = (await response.json()) as NoteDetail | ApiError;
        if (!response.ok || "error" in payload) {
          if ("error" in payload && payload.error.current) {
            conflictRef.current = payload.error.current;
            setConflict(payload.error.current);
            setSaveState("conflict");
            return;
          }
          throw new Error(
            "error" in payload
              ? payload.error.message
              : "The note could not be organized",
          );
        }
        versionRef.current = payload.optimisticVersion;
        onSaved(payload);
        setSaveState("saved");
      } catch (error) {
        setSaveState("error");
        setSaveMessage(
          error instanceof Error
            ? error.message
            : "The note could not be organized",
        );
      } finally {
        setActionPending(false);
      }
    }

    async function permanentlyDelete(): Promise<string | null> {
      if (!(await flush()))
        return "The note could not be saved before deletion.";
      try {
        const response = await fetch(`/api/notes/${note.id}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "delete",
            expectedVersion: versionRef.current,
          }),
        });
        const payload = (await response.json()) as
          { id: string; deleted: true } | ApiError;
        if (!response.ok || "error" in payload) {
          return "error" in payload
            ? payload.error.message
            : "The note could not be permanently deleted";
        }
        setConfirmPermanentDelete(false);
        clearPersistedDraft(note.id);
        onDeleted(note.id);
        return null;
      } catch (error) {
        return error instanceof Error
          ? error.message
          : "The note could not be permanently deleted";
      }
    }

    function restoreDraft(draft: RecoverableDraft) {
      setTitle(draft.title);
      editor?.commands.setContent(draft.content, { emitUpdate: false });
      setRecoverableDraft(null);
      markDirty(draft.title, draft.content);
    }

    function useServerVersion() {
      if (!conflict) return;
      setRecoverableDraft({
        title: titleRef.current,
        content: contentRef.current,
      });
      setTitle(conflict.title);
      titleRef.current = conflict.title;
      contentRef.current = conflict.content;
      versionRef.current = conflict.optimisticVersion;
      editor?.commands.setContent(conflict.content, { emitUpdate: false });
      savedRevisionRef.current = revisionRef.current;
      conflictRef.current = null;
      setConflict(null);
      setSaveState("saved");
      setSaveMessage(
        "Latest server version loaded. Your local draft can still be restored.",
      );
    }

    function keepLocalDraft() {
      if (!conflict) return;
      versionRef.current = conflict.optimisticVersion;
      conflictRef.current = null;
      setConflict(null);
      savedRevisionRef.current = Math.max(0, revisionRef.current - 1);
      setSaveState("unsaved");
      void flushRef.current();
    }

    function openMention(target: EventTarget | null) {
      if (!(target instanceof Element)) return;
      const mention = target.closest<HTMLElement>(".note-mention");
      if (!mention || mention.dataset.state === "missing") return;
      const targetId = mention.dataset.noteTarget;
      if (targetId) onOpenLinkedNote(targetId);
    }

    function onEditorClick(event: ReactMouseEvent<HTMLDivElement>) {
      openMention(event.target);
    }

    function onEditorKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest(".note-mention")) return;
      event.preventDefault();
      openMention(event.target);
    }

    return (
      <section className="editor-pane" aria-labelledby="note-title-label">
        <header className="editor-header">
          <button
            type="button"
            className="icon-button mobile-only"
            aria-label="Back to note list"
            title="Back to notes"
            onClick={async () => {
              if (await flush()) onBack();
            }}
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <div
            className="save-indicator"
            data-state={saveState}
            role="status"
            aria-live="polite"
          >
            <SaveIcon state={saveState} />
            <span>{saveLabel(saveState)}</span>
          </div>
          <div className="editor-actions">
            {!note.trashedAt ? (
              <>
                <button
                  type="button"
                  className="icon-button"
                  disabled={actionPending}
                  aria-label={note.pinnedAt ? "Unpin note" : "Pin note"}
                  title={note.pinnedAt ? "Unpin note" : "Pin note"}
                  onClick={() =>
                    void runLifecycle(note.pinnedAt ? "unpin" : "pin")
                  }
                >
                  {note.pinnedAt ? <PinOff size={18} /> : <Pin size={18} />}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  disabled={actionPending}
                  aria-label={
                    note.archivedAt
                      ? "Restore note from archive"
                      : "Archive note"
                  }
                  title={note.archivedAt ? "Restore from archive" : "Archive"}
                  onClick={() =>
                    void runLifecycle(note.archivedAt ? "unarchive" : "archive")
                  }
                >
                  {note.archivedAt ? (
                    <ArchiveRestore size={18} />
                  ) : (
                    <Archive size={18} />
                  )}
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="icon-button"
              disabled={actionPending}
              aria-label={
                note.trashedAt ? "Restore note" : "Move note to trash"
              }
              title={note.trashedAt ? "Restore note" : "Move to trash"}
              onClick={() =>
                void runLifecycle(note.trashedAt ? "restore" : "trash")
              }
            >
              {note.trashedAt ? <RotateCcw size={18} /> : <Trash2 size={18} />}
            </button>
            {note.trashedAt ? (
              <button
                type="button"
                className="icon-button danger-icon"
                disabled={actionPending}
                aria-label="Delete note permanently"
                title="Delete permanently"
                onClick={() => setConfirmPermanentDelete(true)}
              >
                <Trash2 size={18} />
              </button>
            ) : null}
          </div>
        </header>

        {saveMessage ? (
          <div
            className={`editor-banner ${saveState === "error" ? "error-banner" : ""}`}
            role={saveState === "error" ? "alert" : "status"}
          >
            <span>{saveMessage}</span>
            {saveState === "error" ? (
              <button type="button" onClick={() => void flush()}>
                Retry
              </button>
            ) : null}
          </div>
        ) : null}

        {conflict ? (
          <div className="conflict-banner" role="alert">
            <AlertTriangle size={19} aria-hidden="true" />
            <div>
              <strong>This note changed in another editor</strong>
              <span>
                Your local draft is preserved. Choose which version should
                continue.
              </span>
            </div>
            <button type="button" onClick={useServerVersion}>
              Reload latest
            </button>
            <button
              type="button"
              className="primary-small"
              onClick={keepLocalDraft}
            >
              Keep my draft
            </button>
          </div>
        ) : null}

        {recoverableDraft ? (
          <div className="recovery-banner" role="status">
            <CloudOff size={18} aria-hidden="true" />
            <span>An unsaved local draft is available.</span>
            <button
              type="button"
              onClick={() => restoreDraft(recoverableDraft)}
            >
              Restore draft
            </button>
            <button
              type="button"
              onClick={() => {
                clearPersistedDraft(note.id);
                setRecoverableDraft(null);
              }}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        <div className="title-wrap">
          <label id="note-title-label" htmlFor="note-title" className="sr-only">
            Note title
          </label>
          <input
            id="note-title"
            className="note-title-input"
            value={title}
            maxLength={500}
            placeholder="Untitled Note"
            onChange={(event) => {
              const nextTitle = event.target.value;
              setTitle(nextTitle);
              markDirty(nextTitle, contentRef.current);
            }}
            onBlur={() => void flush()}
          />
          <p className="note-metadata">
            Edited{" "}
            {new Intl.DateTimeFormat(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(note.updatedAt))}
          </p>
          {organization ? (
            <div className="note-organization-controls">
              <label>
                <FolderClosed size={14} aria-hidden="true" />
                <span className="sr-only">Move note to folder</span>
                <select
                  aria-label="Move note to folder"
                  value={note.folder?.id ?? ""}
                  disabled={actionPending}
                  onChange={(event) =>
                    void updateOrganization({
                      folderId: event.target.value || null,
                    })
                  }
                >
                  <option value="">No folder</option>
                  {organization.folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              </label>
              <details className="note-tag-picker">
                <summary>
                  <Tags size={14} aria-hidden="true" />
                  Tags ({note.tags.length})
                </summary>
                <div>
                  {organization.tags.length ? (
                    organization.tags.map((tag) => {
                      const checked = note.tags.some(({ id }) => id === tag.id);
                      return (
                        <label key={tag.id}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={actionPending}
                            onChange={() =>
                              void updateOrganization({
                                tagIds: checked
                                  ? note.tags
                                      .filter(({ id }) => id !== tag.id)
                                      .map(({ id }) => id)
                                  : [...note.tags.map(({ id }) => id), tag.id],
                              })
                            }
                          />
                          <span
                            className="tag-dot"
                            style={{
                              backgroundColor: tag.color ?? "var(--subtle)",
                            }}
                            aria-hidden="true"
                          />
                          {tag.displayName}
                        </label>
                      );
                    })
                  ) : (
                    <span>No tags yet. Add them from workspace settings.</span>
                  )}
                </div>
              </details>
            </div>
          ) : null}
        </div>

        <EditorToolbar editor={editor} />
        <div
          className="editor-scroll-area"
          onClick={onEditorClick}
          onKeyDown={onEditorKeyDown}
        >
          <EditorContent editor={editor} />
          <BacklinksPanel noteId={note.id} onOpenNote={onOpenLinkedNote} />
        </div>
        <PermanentDeleteDialog
          open={confirmPermanentDelete}
          noteTitle={note.title}
          onCancel={() => setConfirmPermanentDelete(false)}
          onConfirm={permanentlyDelete}
        />
      </section>
    );
  },
);

function SaveIcon({ state }: { state: SaveState }) {
  if (state === "saving")
    return <LoaderCircle className="spin" size={15} aria-hidden="true" />;
  if (state === "error" || state === "conflict")
    return <CloudOff size={15} aria-hidden="true" />;
  return <Check size={15} aria-hidden="true" />;
}

function saveLabel(state: SaveState): string {
  if (state === "saving") return "Saving…";
  if (state === "unsaved") return "Unsaved changes";
  if (state === "error") return "Save failed";
  if (state === "conflict") return "Conflict";
  return "Saved";
}

function draftKey(noteId: string) {
  return `linked-notes:draft:${noteId}`;
}

function persistDraft(
  noteId: string,
  version: number,
  title: string,
  content: EditorDocument,
) {
  try {
    sessionStorage.setItem(
      draftKey(noteId),
      JSON.stringify({ version, title, content }),
    );
  } catch {
    // The live draft remains in memory when storage is unavailable.
  }
}

function readPersistedDraft(noteId: string): RecoverableDraft | null {
  try {
    const value = sessionStorage.getItem(draftKey(noteId));
    if (!value) return null;
    const parsed = JSON.parse(value) as RecoverableDraft;
    if (
      typeof parsed.title !== "string" ||
      !parsed.content ||
      parsed.content.type !== "doc"
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearPersistedDraft(noteId: string) {
  try {
    sessionStorage.removeItem(draftKey(noteId));
  } catch {
    // No action is required when session storage is unavailable.
  }
}
