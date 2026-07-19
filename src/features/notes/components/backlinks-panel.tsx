"use client";

import { ChevronDown, Link2, LoaderCircle } from "lucide-react";
import { useState } from "react";

import type { ApiError, BacklinksResponse } from "../types";

type BacklinksPanelProps = {
  noteId: string;
  onOpenNote: (noteId: string) => void;
};

export function BacklinksPanel({ noteId, onOpenNote }: BacklinksPanelProps) {
  const [backlinks, setBacklinks] = useState<BacklinksResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadBacklinks(cursor?: string) {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const search = new URLSearchParams({ limit: "50" });
      if (cursor) search.set("cursor", cursor);
      const response = await fetch(`/api/notes/${noteId}/backlinks?${search}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as BacklinksResponse | ApiError;
      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload
            ? payload.error.message
            : "Backlinks could not be loaded",
        );
      }
      setBacklinks((current) =>
        cursor && current ? mergeBacklinkPages(current, payload) : payload,
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Backlinks could not be loaded",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <details
      className="backlinks-panel"
      onToggle={(event) => {
        if (event.currentTarget.open && !backlinks && !error) {
          void loadBacklinks();
        }
      }}
    >
      <summary>
        <span>
          <Link2 size={16} aria-hidden="true" />
          Backlinks
          {backlinks ? ` (${backlinks.totalMentions})` : ""}
        </span>
        <ChevronDown
          className="backlinks-chevron"
          size={17}
          aria-hidden="true"
        />
      </summary>
      <div className="backlinks-content">
        {loading ? (
          <div className="backlinks-state" role="status">
            <LoaderCircle className="spin" size={17} aria-hidden="true" />
            Loading backlinks…
          </div>
        ) : null}
        {error ? (
          <div className="backlinks-state error-state" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void loadBacklinks()}>
              Retry
            </button>
          </div>
        ) : null}
        {backlinks && backlinks.items.length === 0 ? (
          <p className="backlinks-state">No notes link here yet.</p>
        ) : null}
        {backlinks?.items.map((backlink) => (
          <article className="backlink-card" key={backlink.sourceNoteId}>
            <button
              type="button"
              className="backlink-source"
              onClick={() => onOpenNote(backlink.sourceNoteId)}
            >
              <strong>{backlink.sourceTitle}</strong>
              {backlink.sourceState !== "active" ? (
                <small>{backlink.sourceState}</small>
              ) : null}
            </button>
            <ul aria-label={`Contexts from ${backlink.sourceTitle}`}>
              {backlink.contexts.map((context) => (
                <li key={context.mentionId}>{context.context}</li>
              ))}
            </ul>
          </article>
        ))}
        {backlinks?.nextCursor ? (
          <button
            type="button"
            className="load-more-button"
            disabled={loading}
            onClick={() => void loadBacklinks(backlinks.nextCursor!)}
          >
            {loading ? "Loading…" : "Load more backlinks"}
          </button>
        ) : null}
      </div>
    </details>
  );
}

function mergeBacklinkPages(
  current: BacklinksResponse,
  next: BacklinksResponse,
): BacklinksResponse {
  const items = current.items.map((item) => ({
    ...item,
    contexts: [...item.contexts],
  }));
  for (const incoming of next.items) {
    const existing = items.find(
      ({ sourceNoteId }) => sourceNoteId === incoming.sourceNoteId,
    );
    if (existing) existing.contexts.push(...incoming.contexts);
    else items.push(incoming);
  }
  return {
    items,
    totalMentions: next.totalMentions,
    nextCursor: next.nextCursor,
  };
}
