"use client";

import {
  ExternalLink,
  LoaderCircle,
  MessageCircleQuestion,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";

import type { AiAskResponse, AiStatusResponse, ApiError } from "../types";
import { trapDialogFocus } from "./dialog-focus";

type WorkspaceAiDialogProps = {
  open: boolean;
  onClose: () => void;
  onOpenNote: (noteId: string) => void;
};

export function WorkspaceAiDialog({
  open,
  onClose,
  onOpenNote,
}: WorkspaceAiDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState<AiStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AiAskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      dialog.showModal();
      requestAnimationFrame(() => questionRef.current?.focus());
      if (!status && !statusLoading) void loadStatus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, status, statusLoading]);

  async function loadStatus() {
    setStatusLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/status", { cache: "no-store" });
      const payload = (await response.json()) as AiStatusResponse | ApiError;
      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload
            ? payload.error.message
            : "Local AI status could not be checked",
        );
      }
      setStatus(payload);
    } catch (statusError) {
      setError(
        statusError instanceof Error
          ? statusError.message
          : "Local AI status could not be checked",
      );
    } finally {
      setStatusLoading(false);
    }
  }

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || pending) return;
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }),
      });
      const payload = (await response.json()) as AiAskResponse | ApiError;
      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload
            ? payload.error.message
            : "Your notes could not answer that question",
        );
      }
      setResult(payload);
    } catch (askError) {
      setError(
        askError instanceof Error
          ? askError.message
          : "Your notes could not answer that question",
      );
    } finally {
      setPending(false);
    }
  }

  const ready = Boolean(
    status?.enabled && status.available && status.modelsReady,
  );

  return (
    <dialog
      ref={dialogRef}
      className="workspace-ai-dialog"
      aria-labelledby="workspace-ai-title"
      onKeyDown={trapDialogFocus}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) dialogRef.current?.close();
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
          <p>Local AI</p>
          <h2 id="workspace-ai-title">Ask your notes</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          disabled={pending}
          aria-label="Close Ask your notes"
          onClick={() => dialogRef.current?.close()}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <div className="workspace-ai-body">
        <div className="workspace-ai-privacy">
          <Sparkles size={17} aria-hidden="true" />
          <p>
            Ollama searches saved note text on this Mac. It answers only from
            linked source notes and never changes them.
          </p>
          <span data-state={ready ? "ready" : "offline"}>
            {statusLoading
              ? "Checking Ollama"
              : ready
                ? `Ready · ${status?.chatModel}`
                : "Setup needed"}
          </span>
        </div>

        {status && !ready ? (
          <div className="ai-setup-state" role="status">
            <TriangleAlert size={18} aria-hidden="true" />
            <div>
              <strong>{status.message || "Local AI is not ready."}</strong>
              {status.missingModels.length > 0 ? (
                <span>Missing: {status.missingModels.join(", ")}</span>
              ) : null}
            </div>
            <button type="button" onClick={() => void loadStatus()}>
              Check again
            </button>
          </div>
        ) : null}

        <form
          className="workspace-ai-form"
          onSubmit={(event) => void ask(event)}
        >
          <label htmlFor="workspace-ai-question">Question</label>
          <textarea
            ref={questionRef}
            id="workspace-ai-question"
            maxLength={500}
            rows={3}
            value={question}
            placeholder="What did I decide about the deployment?"
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div>
            <small>{question.length}/500 · ⌘/Ctrl + Enter to ask</small>
            <button
              type="submit"
              disabled={!ready || pending || question.trim().length < 3}
            >
              {pending ? (
                <LoaderCircle className="spin" size={16} aria-hidden="true" />
              ) : (
                <MessageCircleQuestion size={16} aria-hidden="true" />
              )}
              {pending ? "Searching notes…" : "Ask notes"}
            </button>
          </div>
        </form>

        {error ? (
          <div className="ai-error-state" role="alert">
            <TriangleAlert size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        {result ? (
          <section className="workspace-ai-answer" aria-live="polite">
            <header>
              <Sparkles size={17} aria-hidden="true" />
              <h3>Answer from your notes</h3>
              <small>{result.scannedNotes} scanned</small>
            </header>
            {result.answer ? (
              <>
                <p>{result.answer}</p>
                <h4>Sources</h4>
                <div className="workspace-ai-sources">
                  {result.citations.map((citation) => (
                    <article key={citation.noteId}>
                      <header>
                        <strong>{citation.title}</strong>
                        {citation.state === "archived" ? (
                          <span>Archived</span>
                        ) : null}
                      </header>
                      <p>{citation.excerpt || "No additional text"}</p>
                      <small>{citation.reason}</small>
                      <button
                        type="button"
                        onClick={() => {
                          dialogRef.current?.close();
                          onOpenNote(citation.noteId);
                        }}
                      >
                        <ExternalLink size={14} aria-hidden="true" />
                        Open source note
                      </button>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <p className="ai-empty-result">
                The shortlisted notes did not contain enough evidence to answer
                that question.
              </p>
            )}
            {result.scanLimitReached || result.truncated ? (
              <small className="ai-result-note">
                {result.scanLimitReached
                  ? "The 1,000 most recently updated notes were searched. "
                  : ""}
                {result.truncated
                  ? "Very long sources were shortened before answering."
                  : ""}
              </small>
            ) : null}
          </section>
        ) : null}
      </div>
    </dialog>
  );
}
