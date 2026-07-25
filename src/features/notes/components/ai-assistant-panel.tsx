"use client";

import {
  ChevronDown,
  ExternalLink,
  Link2,
  ListTree,
  LoaderCircle,
  Plus,
  ScanSearch,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";

import type {
  AiAnalysisResponse,
  AiConnectionSuggestion,
  AiStatusResponse,
  ApiError,
} from "../types";

type AiAction = AiAnalysisResponse["action"];

type AiAssistantPanelProps = {
  noteId: string;
  revision: number;
  beforeAnalysis: () => Promise<boolean>;
  onInsertSummary: (bullets: string[]) => void;
  onInsertLink: (suggestion: AiConnectionSuggestion) => void;
  onOpenNote: (noteId: string) => void;
};

export function AiAssistantPanel({
  noteId,
  revision,
  beforeAnalysis,
  onInsertSummary,
  onInsertLink,
  onOpenNote,
}: AiAssistantPanelProps) {
  const [status, setStatus] = useState<AiStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [result, setResult] = useState<AiAnalysisResponse | null>(null);
  const [resultRevision, setResultRevision] = useState<number | null>(null);
  const [pendingAction, setPendingAction] = useState<AiAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stale = Boolean(result && resultRevision !== revision);

  async function loadStatus() {
    if (statusLoading) return;
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

  async function runAnalysis(action: AiAction) {
    if (pendingAction) return;
    setError(null);
    if (!(await beforeAnalysis())) {
      setError("Save the note successfully before running local AI.");
      return;
    }

    const requestedRevision = revision;
    setPendingAction(action);
    try {
      const response = await fetch(`/api/notes/${noteId}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json()) as AiAnalysisResponse | ApiError;
      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload
            ? payload.error.message
            : "The local analysis could not be completed",
        );
      }
      setResult(payload);
      setResultRevision(requestedRevision);
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "The local analysis could not be completed",
      );
    } finally {
      setPendingAction(null);
    }
  }

  const ready = Boolean(
    status?.enabled && status.available && status.modelsReady,
  );

  return (
    <details
      className="ai-assistant-panel"
      onToggle={(event) => {
        if (event.currentTarget.open && !status && !statusLoading) {
          void loadStatus();
        }
      }}
    >
      <summary>
        <span>
          <Sparkles size={16} aria-hidden="true" />
          AI assistant
          <small>Local only</small>
        </span>
        <ChevronDown className="ai-chevron" size={17} aria-hidden="true" />
      </summary>
      <div className="ai-assistant-content">
        <header className="ai-assistant-intro">
          <div>
            <strong>Think with your notes</strong>
            <p>
              Ollama analyses saved note text on this Mac. Nothing runs until
              you choose an action, and nothing is inserted automatically.
            </p>
          </div>
          <AiStatus status={status} loading={statusLoading} />
        </header>

        {status && !ready ? (
          <div className="ai-setup-state" role="status">
            <TriangleAlert size={18} aria-hidden="true" />
            <div>
              <strong>{status.message || "Local AI is not ready."}</strong>
              {status.missingModels.length > 0 ? (
                <span>
                  Missing:{" "}
                  {status.missingModels.map((model) => model).join(", ")}
                </span>
              ) : null}
            </div>
            <button type="button" onClick={() => void loadStatus()}>
              Check again
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="ai-error-state" role="alert">
            <TriangleAlert size={18} aria-hidden="true" />
            <span>{error}</span>
            {!status ? (
              <button type="button" onClick={() => void loadStatus()}>
                Retry
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="ai-action-grid" aria-label="Local AI actions">
          <button
            type="button"
            disabled={!ready || Boolean(pendingAction)}
            onClick={() => void runAnalysis("summarize")}
          >
            {pendingAction === "summarize" ? (
              <LoaderCircle className="spin" size={19} aria-hidden="true" />
            ) : (
              <ListTree size={19} aria-hidden="true" />
            )}
            <span>
              <strong>Summarise</strong>
              <small>Turn this note into concise bullet points</small>
            </span>
          </button>
          <button
            type="button"
            disabled={!ready || Boolean(pendingAction)}
            onClick={() => void runAnalysis("find-connections")}
          >
            {pendingAction === "find-connections" ? (
              <LoaderCircle className="spin" size={19} aria-hidden="true" />
            ) : (
              <ScanSearch size={19} aria-hidden="true" />
            )}
            <span>
              <strong>Find connections</strong>
              <small>Spot duplicates and notes worth linking</small>
            </span>
          </button>
        </div>

        {stale ? (
          <p className="ai-stale-state" role="status">
            This result is from an earlier version of the note. Run the analysis
            again before inserting it.
          </p>
        ) : null}

        {result?.action === "summarize" ? (
          <section className="ai-result" aria-labelledby="ai-summary-title">
            <header>
              <div>
                <Sparkles size={17} aria-hidden="true" />
                <h3 id="ai-summary-title">Suggested summary</h3>
              </div>
              <button
                type="button"
                className="primary-small"
                disabled={stale}
                onClick={() => onInsertSummary(result.bullets)}
              >
                <Plus size={15} aria-hidden="true" />
                Insert bullets
              </button>
            </header>
            <ul>
              {result.bullets.map((bullet, index) => (
                <li key={`${index}-${bullet}`}>{bullet}</li>
              ))}
            </ul>
            {result.truncated ? (
              <p className="ai-result-note">
                The note was longer than the local analysis limit, so this
                summary covers the first portion only.
              </p>
            ) : null}
          </section>
        ) : null}

        {result?.action === "find-connections" ? (
          <section className="ai-result" aria-labelledby="ai-connections-title">
            <header>
              <div>
                <Link2 size={17} aria-hidden="true" />
                <h3 id="ai-connections-title">Suggested connections</h3>
              </div>
              <small>
                {result.scannedNotes} note
                {result.scannedNotes === 1 ? "" : "s"} scanned
              </small>
            </header>
            {result.suggestions.length > 0 ? (
              <div className="ai-connection-grid">
                {result.suggestions.map((suggestion) => (
                  <ConnectionCard
                    key={suggestion.noteId}
                    suggestion={suggestion}
                    insertionDisabled={stale}
                    onInsertLink={onInsertLink}
                    onOpenNote={onOpenNote}
                  />
                ))}
              </div>
            ) : (
              <p className="ai-empty-result">
                No confident duplicates or useful links were found.
              </p>
            )}
            {result.scanLimitReached || result.truncated ? (
              <p className="ai-result-note">
                {result.scanLimitReached
                  ? "The scan used the 1,000 most recently updated notes. "
                  : ""}
                {result.truncated
                  ? "Very long note content was shortened for local analysis."
                  : ""}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </details>
  );
}

function AiStatus({
  status,
  loading,
}: {
  status: AiStatusResponse | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <span className="ai-status" data-state="checking">
        <LoaderCircle className="spin" size={14} aria-hidden="true" />
        Checking Ollama
      </span>
    );
  }
  if (!status) {
    return <span className="ai-status">Not checked</span>;
  }
  if (status.enabled && status.available && status.modelsReady) {
    return (
      <span className="ai-status" data-state="ready">
        Ready · {status.chatModel}
      </span>
    );
  }
  return (
    <span className="ai-status" data-state="offline">
      Setup needed
    </span>
  );
}

function ConnectionCard({
  suggestion,
  insertionDisabled,
  onInsertLink,
  onOpenNote,
}: {
  suggestion: AiConnectionSuggestion;
  insertionDisabled: boolean;
  onInsertLink: (suggestion: AiConnectionSuggestion) => void;
  onOpenNote: (noteId: string) => void;
}) {
  return (
    <article className="ai-connection-card">
      <header>
        <strong>{suggestion.title}</strong>
        <div>
          <span data-relationship={suggestion.relationship}>
            {suggestion.relationship}
          </span>
          {suggestion.state === "archived" ? <span>archived</span> : null}
          {suggestion.alreadyLinked ? <span>linked</span> : null}
        </div>
      </header>
      <p>{suggestion.reason}</p>
      <small>{Math.round(suggestion.confidence * 100)}% confidence</small>
      <footer>
        <button
          type="button"
          disabled={insertionDisabled || suggestion.alreadyLinked}
          onClick={() => onInsertLink(suggestion)}
        >
          <Link2 size={14} aria-hidden="true" />
          {suggestion.alreadyLinked ? "Already linked" : "Insert @link"}
        </button>
        <button type="button" onClick={() => onOpenNote(suggestion.noteId)}>
          <ExternalLink size={14} aria-hidden="true" />
          Open note
        </button>
      </footer>
    </article>
  );
}
