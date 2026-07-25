"use client";

import {
  ChevronDown,
  ExternalLink,
  Link2,
  ListTree,
  LoaderCircle,
  PenLine,
  Plus,
  Replace,
  ScanSearch,
  Sparkles,
  TextSelect,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";

import type {
  AiAnalysisResponse,
  AiConnectionSuggestion,
  AiRewriteMode,
  AiStatusResponse,
  ApiError,
} from "../types";

type AiAction = AiAnalysisResponse["action"];

export type AiEditorSelection = {
  from: number;
  to: number;
  text: string;
};

type AiAssistantPanelProps = {
  noteId: string;
  revision: number;
  beforeAnalysis: () => Promise<boolean>;
  onInsertSummary: (bullets: string[]) => void;
  onInsertLink: (suggestion: AiConnectionSuggestion) => void;
  selection: AiEditorSelection | null;
  onReplaceSelection: (
    text: string,
    mode: AiRewriteMode,
    selection: AiEditorSelection,
  ) => void;
  onInsertAfterSelection: (
    text: string,
    mode: AiRewriteMode,
    selection: AiEditorSelection,
  ) => void;
  onOpenNote: (noteId: string) => void;
};

export function AiAssistantPanel({
  noteId,
  revision,
  beforeAnalysis,
  onInsertSummary,
  onInsertLink,
  selection,
  onReplaceSelection,
  onInsertAfterSelection,
  onOpenNote,
}: AiAssistantPanelProps) {
  const [status, setStatus] = useState<AiStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [result, setResult] = useState<AiAnalysisResponse | null>(null);
  const [resultRevision, setResultRevision] = useState<number | null>(null);
  const [pendingAction, setPendingAction] = useState<AiAction | null>(null);
  const [rewriteMode, setRewriteMode] = useState<AiRewriteMode>("clarify");
  const [tone, setTone] = useState<
    "professional" | "friendly" | "concise" | "confident"
  >("professional");
  const [targetLanguage, setTargetLanguage] = useState("French");
  const [resultSelection, setResultSelection] =
    useState<AiEditorSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stale = Boolean(
    result &&
    (resultRevision !== revision ||
      (result.action === "rewrite-selection" &&
        selectionSignature(selection) !== selectionSignature(resultSelection))),
  );

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
    const requestedSelection =
      action === "rewrite-selection" ? selection : null;
    if (action === "rewrite-selection" && !requestedSelection) {
      setError("Select some note text before requesting a writing preview.");
      return;
    }
    setPendingAction(action);
    try {
      const response = await fetch(`/api/notes/${noteId}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "rewrite-selection"
            ? {
                action,
                mode: rewriteMode,
                selectedText: requestedSelection?.text,
                ...(rewriteMode === "tone" ? { tone } : {}),
                ...(rewriteMode === "translate"
                  ? { targetLanguage: targetLanguage.trim() }
                  : {}),
              }
            : { action },
        ),
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
      setResultSelection(requestedSelection);
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

        <section
          className="ai-writing-tools"
          aria-labelledby="ai-writing-tools-title"
        >
          <header>
            <div>
              <PenLine size={17} aria-hidden="true" />
              <span>
                <strong id="ai-writing-tools-title">Rewrite selection</strong>
                <small>
                  Preview a local rewrite, then choose whether to insert it.
                </small>
              </span>
            </div>
            <span data-selected={selection ? "true" : undefined}>
              <TextSelect size={14} aria-hidden="true" />
              {selection
                ? `${selection.text.length} characters selected`
                : "Select note text"}
            </span>
          </header>
          <div className="ai-writing-controls">
            <label>
              Writing task
              <select
                aria-label="Selection writing task"
                value={rewriteMode}
                onChange={(event) =>
                  setRewriteMode(event.target.value as AiRewriteMode)
                }
              >
                <option value="shorten">Shorten</option>
                <option value="clarify">Rewrite clearly</option>
                <option value="proofread">Fix spelling and grammar</option>
                <option value="bullets">Turn into bullets</option>
                <option value="expand">Expand outline</option>
                <option value="tone">Change tone</option>
                <option value="translate">Translate</option>
              </select>
            </label>
            {rewriteMode === "tone" ? (
              <label>
                Tone
                <select
                  aria-label="Target tone"
                  value={tone}
                  onChange={(event) =>
                    setTone(
                      event.target.value as
                        "professional" | "friendly" | "concise" | "confident",
                    )
                  }
                >
                  <option value="professional">Professional</option>
                  <option value="friendly">Friendly</option>
                  <option value="concise">Concise</option>
                  <option value="confident">Confident</option>
                </select>
              </label>
            ) : null}
            {rewriteMode === "translate" ? (
              <label>
                Language
                <input
                  aria-label="Target language"
                  maxLength={50}
                  value={targetLanguage}
                  onChange={(event) => setTargetLanguage(event.target.value)}
                />
              </label>
            ) : null}
            <button
              type="button"
              disabled={
                !ready ||
                !selection ||
                Boolean(pendingAction) ||
                (rewriteMode === "translate" &&
                  targetLanguage.trim().length < 2)
              }
              onClick={() => void runAnalysis("rewrite-selection")}
            >
              {pendingAction === "rewrite-selection" ? (
                <LoaderCircle className="spin" size={16} aria-hidden="true" />
              ) : (
                <Sparkles size={16} aria-hidden="true" />
              )}
              Preview rewrite
            </button>
          </div>
          {selection ? (
            <blockquote>{compactSelection(selection.text)}</blockquote>
          ) : (
            <p>
              Highlight text in the editor first. The rest of the note is not
              sent for this action.
            </p>
          )}
        </section>

        {stale ? (
          <p className="ai-stale-state" role="status">
            This result is from an earlier note version or text selection. Run
            the analysis again before inserting it.
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

        {result?.action === "rewrite-selection" && resultSelection ? (
          <section className="ai-result" aria-labelledby="ai-rewrite-title">
            <header>
              <div>
                <PenLine size={17} aria-hidden="true" />
                <h3 id="ai-rewrite-title">Writing preview</h3>
              </div>
              <small>{rewriteLabel(result.mode)}</small>
            </header>
            <pre className="ai-writing-preview">{result.text}</pre>
            <div className="ai-writing-result-actions">
              <button
                type="button"
                disabled={stale}
                onClick={() =>
                  onReplaceSelection(result.text, result.mode, resultSelection)
                }
              >
                <Replace size={14} aria-hidden="true" />
                Replace selection
              </button>
              <button
                type="button"
                disabled={stale}
                onClick={() =>
                  onInsertAfterSelection(
                    result.text,
                    result.mode,
                    resultSelection,
                  )
                }
              >
                <Plus size={14} aria-hidden="true" />
                Insert after
              </button>
            </div>
            {result.truncated ? (
              <p className="ai-result-note">
                The selected text or generated preview reached the local safety
                limit.
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </details>
  );
}

function selectionSignature(selection: AiEditorSelection | null): string {
  return selection
    ? `${selection.from}:${selection.to}:${selection.text}`
    : "none";
}

function compactSelection(value: string): string {
  const compact = value.replaceAll(/\s+/g, " ").trim();
  return compact.length > 240 ? `${compact.slice(0, 237)}…` : compact;
}

function rewriteLabel(mode: AiRewriteMode): string {
  if (mode === "shorten") return "Shortened";
  if (mode === "clarify") return "Clear rewrite";
  if (mode === "proofread") return "Proofread";
  if (mode === "bullets") return "Bullet list";
  if (mode === "expand") return "Expanded";
  if (mode === "tone") return "Tone changed";
  return "Translated";
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
