"use client";

import {
  Clock3,
  LoaderCircle,
  RotateCcw,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ApiError, NoteHistoryPage, NoteRevisionSummary } from "../types";
import { trapDialogFocus } from "./dialog-focus";

type NoteHistoryDialogProps = {
  open: boolean;
  noteId: string;
  currentText: string;
  onClose: () => void;
  onRestore: (revisionId: string) => Promise<string | null>;
};

export function NoteHistoryDialog({
  open,
  noteId,
  currentText,
  onClose,
  onRestore,
}: NoteHistoryDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [history, setHistory] = useState<NoteHistoryPage | null>(null);
  const [selected, setSelected] = useState<NoteRevisionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/notes/${noteId}/history`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as NoteHistoryPage | ApiError;
      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload
            ? payload.error.message
            : "Note history could not be loaded",
        );
      }
      setHistory(payload);
      setSelected(payload.items[0] ?? null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Note history could not be loaded",
      );
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      dialog.showModal();
      void loadHistory();
    }
    if (!open && dialog.open) dialog.close();
  }, [loadHistory, open]);

  async function restore() {
    if (!selected || restoring) return;
    setRestoring(true);
    setError(null);
    const message = await onRestore(selected.id);
    setRestoring(false);
    if (message) {
      setError(message);
      return;
    }
    dialogRef.current?.close();
  }

  return (
    <dialog
      ref={dialogRef}
      className="note-history-dialog"
      aria-labelledby="note-history-title"
      onKeyDown={trapDialogFocus}
      onCancel={(event) => {
        event.preventDefault();
        if (!restoring) dialogRef.current?.close();
      }}
      onClose={() => {
        const previous = previousFocusRef.current;
        previousFocusRef.current = null;
        if (previous?.isConnected)
          requestAnimationFrame(() => previous.focus());
        onClose();
      }}
    >
      <header className="dialog-header">
        <div>
          <p>Version history</p>
          <h2 id="note-history-title">Restore an earlier note</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close note history"
          disabled={restoring}
          onClick={() => dialogRef.current?.close()}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      {error ? (
        <div className="dialog-message error-state" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          {error}
        </div>
      ) : null}
      <div className="note-history-layout">
        <div className="note-history-list">
          {loading ? (
            <span className="dialog-loading">
              <LoaderCircle className="spin" size={17} aria-hidden="true" />
              Loading saved versions…
            </span>
          ) : history?.items.length ? (
            history.items.map((revision) => (
              <button
                type="button"
                key={revision.id}
                data-active={selected?.id === revision.id || undefined}
                onClick={() => setSelected(revision)}
              >
                <Clock3 size={15} aria-hidden="true" />
                <span>
                  <strong>
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(revision.createdAt))}
                  </strong>
                  <small>
                    Version {revision.noteVersion} ·{" "}
                    {revision.reason === "restore" ? "before restore" : "edit"}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <p>No earlier versions have been captured yet.</p>
          )}
        </div>
        <section className="note-history-preview">
          {selected ? (
            <>
              <header>
                <div>
                  <small>Saved title</small>
                  <h3>{selected.title}</h3>
                </div>
                <span>
                  {wordDelta(selected.contentText, currentText)} words vs now
                </span>
              </header>
              <pre>{selected.contentText || "This version is empty."}</pre>
              {selected.truncated ? (
                <small>
                  The preview is truncated; restore uses the full version.
                </small>
              ) : null}
              <div className="dialog-actions">
                <button
                  type="button"
                  disabled={restoring}
                  onClick={() => void restore()}
                >
                  {restoring ? (
                    <LoaderCircle
                      className="spin"
                      size={15}
                      aria-hidden="true"
                    />
                  ) : (
                    <RotateCcw size={15} aria-hidden="true" />
                  )}
                  {restoring ? "Restoring…" : "Restore this version"}
                </button>
              </div>
            </>
          ) : (
            <p>Select a saved version to preview it.</p>
          )}
        </section>
      </div>
    </dialog>
  );
}

function wordDelta(before: string, current: string) {
  const words = (value: string) =>
    value.trim().split(/\s+/).filter(Boolean).length;
  const difference = words(before) - words(current);
  return difference > 0 ? `+${difference}` : String(difference);
}
