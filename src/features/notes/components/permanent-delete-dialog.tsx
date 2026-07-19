"use client";

import { Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type PermanentDeleteDialogProps = {
  open: boolean;
  noteTitle: string;
  onCancel: () => void;
  onConfirm: () => Promise<string | null>;
};

export function PermanentDeleteDialog({
  open,
  noteTitle,
  onCancel,
  onConfirm,
}: PermanentDeleteDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setError(null);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby="permanent-delete-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClose={onCancel}
    >
      <button
        type="button"
        className="icon-button dialog-close"
        aria-label="Cancel permanent deletion"
        onClick={onCancel}
      >
        <X size={18} aria-hidden="true" />
      </button>
      <span className="danger-mark" aria-hidden="true">
        <Trash2 size={22} />
      </span>
      <h2 id="permanent-delete-title">Delete permanently?</h2>
      <p>
        “{noteTitle}” cannot be recovered. Notes that link here will keep a
        visible broken reference.
      </p>
      {error ? (
        <div className="dialog-message error-state" role="alert">
          {error}
        </div>
      ) : null}
      <div className="dialog-actions">
        <button type="button" disabled={pending} onClick={onCancel}>
          Keep note
        </button>
        <button
          type="button"
          className="danger-button"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            const nextError = await onConfirm();
            setPending(false);
            if (nextError) setError(nextError);
          }}
        >
          {pending ? "Deleting…" : "Delete permanently"}
        </button>
      </div>
    </dialog>
  );
}
