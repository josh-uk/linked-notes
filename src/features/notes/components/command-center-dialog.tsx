"use client";

import {
  CalendarDays,
  Check,
  ChevronLeft,
  ClipboardPen,
  Command,
  Download,
  ExternalLink,
  FileInput,
  FilePlus2,
  FolderInput,
  History,
  LoaderCircle,
  Search,
  Sparkles,
  Tags,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { MAX_MARKDOWN_IMPORT_FILES } from "../import-limits";
import type {
  AiCleanupResponse,
  AiCleanupSuggestion,
  ApiError,
  DailyNoteResponse,
  EditorDocument,
  NoteDetail,
  NoteSummary,
  NoteTemplateSummary,
  OrganizationResponse,
  TagSummary,
} from "../types";
import { trapDialogFocus } from "./dialog-focus";

export type CommandCenterView =
  "home" | "capture" | "templates" | "cleanup" | "import";

type CommandCenterDialogProps = {
  open: boolean;
  initialView: CommandCenterView;
  notes: NoteSummary[];
  currentNote: NoteDetail | null;
  onClose: () => void;
  beforeAction: () => Promise<boolean>;
  onCreated: (note: NoteDetail) => void;
  onOpenNote: (noteId: string) => void;
  onWorkspaceChanged: () => Promise<void>;
};

type ImportPreview = {
  committed: boolean;
  files: Array<{
    path: string;
    title: string;
    folder: string | null;
    source: string;
    status: "new" | "existing";
    existingNoteId: string | null;
  }>;
  summary: {
    total: number;
    new: number;
    existing: number;
    appleNotes: number;
    created?: number;
    skipped?: number;
  };
  createdNoteIds?: string[];
};

export function CommandCenterDialog({
  open,
  initialView,
  notes,
  currentNote,
  onClose,
  beforeAction,
  onCreated,
  onOpenNote,
  onWorkspaceChanged,
}: CommandCenterDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [view, setView] = useState<CommandCenterView>(initialView);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [captureTitle, setCaptureTitle] = useState("");
  const [captureBody, setCaptureBody] = useState("");
  const [templates, setTemplates] = useState<NoteTemplateSummary[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [cleanup, setCleanup] = useState<AiCleanupResponse | null>(null);
  const [importFiles, setImportFiles] = useState<
    Array<{ path: string; content: string }>
  >([]);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(
    null,
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setView(initialView);
      setQuery("");
      setError(null);
      setMessage(null);
      dialog.showModal();
      requestAnimationFrame(() => searchRef.current?.focus());
    }
    if (!open && dialog.open) dialog.close();
  }, [initialView, open]);

  useEffect(() => {
    if (open && view === "templates") void loadTemplates();
  }, [open, view]);

  const matchingNotes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return notes.slice(0, 6);
    return notes
      .filter(
        (note) =>
          note.title.toLocaleLowerCase().includes(normalized) ||
          note.excerpt.toLocaleLowerCase().includes(normalized),
      )
      .slice(0, 8);
  }, [notes, query]);

  function navigate(next: CommandCenterView) {
    setView(next);
    setError(null);
    setMessage(null);
  }

  function openNote(id: string) {
    dialogRef.current?.close();
    onOpenNote(id);
  }

  async function createCapture(event: FormEvent) {
    event.preventDefault();
    if (!captureTitle.trim() && !captureBody.trim()) return;
    setPending(true);
    setError(null);
    try {
      if (!(await beforeAction())) return;
      const created = await jsonRequest<NoteDetail>("/api/notes", {
        method: "POST",
        body: JSON.stringify({
          title: captureTitle.trim() || firstLine(captureBody),
        }),
      });
      const content = plainTextDocument(captureBody);
      const saved = captureBody.trim()
        ? await jsonRequest<NoteDetail>(`/api/notes/${created.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              expectedVersion: created.optimisticVersion,
              title: created.title,
              content,
            }),
          })
        : created;
      setCaptureTitle("");
      setCaptureBody("");
      dialogRef.current?.close();
      onCreated(saved);
    } catch (captureError) {
      setError(messageFrom(captureError, "The quick note could not be saved"));
    } finally {
      setPending(false);
    }
  }

  async function openDaily(templateId?: string) {
    setPending(true);
    setError(null);
    try {
      if (!(await beforeAction())) return;
      const now = new Date();
      const date = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("-");
      const result = await jsonRequest<DailyNoteResponse>("/api/notes/daily", {
        method: "POST",
        body: JSON.stringify({ date, ...(templateId ? { templateId } : {}) }),
      });
      dialogRef.current?.close();
      if (result.created) onCreated(result.note);
      else onOpenNote(result.note.id);
    } catch (dailyError) {
      setError(messageFrom(dailyError, "The daily note could not be opened"));
    } finally {
      setPending(false);
    }
  }

  async function loadTemplates() {
    try {
      setTemplates(await jsonRequest<NoteTemplateSummary[]>("/api/templates"));
    } catch (templateError) {
      setError(messageFrom(templateError, "Templates could not be loaded"));
    }
  }

  async function createTemplate(event: FormEvent) {
    event.preventDefault();
    if (!currentNote || !templateName.trim()) return;
    setPending(true);
    setError(null);
    try {
      if (!(await beforeAction())) return;
      await jsonRequest<NoteTemplateSummary>("/api/templates", {
        method: "POST",
        body: JSON.stringify({
          name: templateName.trim(),
          title: currentNote.title,
          content: currentNote.content,
        }),
      });
      setTemplateName("");
      setMessage("Template saved from the current note.");
      await loadTemplates();
    } catch (templateError) {
      setError(messageFrom(templateError, "The template could not be saved"));
    } finally {
      setPending(false);
    }
  }

  async function createFromTemplate(templateId: string) {
    setPending(true);
    setError(null);
    try {
      if (!(await beforeAction())) return;
      const note = await jsonRequest<NoteDetail>("/api/notes", {
        method: "POST",
        body: JSON.stringify({ templateId }),
      });
      dialogRef.current?.close();
      onCreated(note);
    } catch (templateError) {
      setError(messageFrom(templateError, "The note could not be created"));
    } finally {
      setPending(false);
    }
  }

  async function deleteTemplate(templateId: string) {
    setPending(true);
    setError(null);
    try {
      await jsonRequest(`/api/templates/${templateId}`, { method: "DELETE" });
      await loadTemplates();
    } catch (templateError) {
      setError(messageFrom(templateError, "The template could not be deleted"));
    } finally {
      setPending(false);
    }
  }

  async function scanCleanup() {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      if (!(await beforeAction())) return;
      setCleanup(
        await jsonRequest<AiCleanupResponse>("/api/ai/cleanup", {
          method: "POST",
        }),
      );
    } catch (cleanupError) {
      setError(messageFrom(cleanupError, "The cleanup scan could not run"));
    } finally {
      setPending(false);
    }
  }

  async function applyCleanup(suggestion: AiCleanupSuggestion) {
    setPending(true);
    setError(null);
    try {
      if (suggestion.type === "clearer-title") {
        await jsonRequest(`/api/notes/${suggestion.noteId}`, {
          method: "PATCH",
          body: JSON.stringify({
            expectedVersion: suggestion.expectedVersion,
            title: suggestion.suggestedTitle,
          }),
        });
      } else if (suggestion.type === "stale") {
        await jsonRequest(`/api/notes/${suggestion.noteId}/actions`, {
          method: "POST",
          body: JSON.stringify({
            action: "archive",
            expectedVersion: suggestion.expectedVersion,
          }),
        });
      } else if (suggestion.type === "missing-tags") {
        await addSuggestedTags(suggestion);
      } else if (suggestion.type === "related-link") {
        await addSuggestedLink(suggestion);
      }
      setCleanup((current) =>
        current
          ? {
              ...current,
              suggestions: current.suggestions.filter(
                ({ id }) => id !== suggestion.id,
              ),
            }
          : null,
      );
      await onWorkspaceChanged();
    } catch (cleanupError) {
      setError(
        messageFrom(
          cleanupError,
          "That suggestion is stale or could not be applied",
        ),
      );
    } finally {
      setPending(false);
    }
  }

  async function addSuggestedTags(suggestion: AiCleanupSuggestion) {
    const note = await jsonRequest<NoteDetail>(
      `/api/notes/${suggestion.noteId}`,
    );
    if (note.optimisticVersion !== suggestion.expectedVersion) {
      throw new Error("The note changed after this scan. Run cleanup again.");
    }
    const latestOrganization =
      await jsonRequest<OrganizationResponse>("/api/organization");
    const tagIds = new Set(note.tags.map(({ id }) => id));
    for (const name of suggestion.suggestedTags) {
      let tag = latestOrganization.tags.find(
        (candidate) => normalize(candidate.displayName) === normalize(name),
      );
      if (!tag) {
        tag = await jsonRequest<TagSummary>("/api/tags", {
          method: "POST",
          body: JSON.stringify({ name, color: null }),
        });
        latestOrganization.tags.push(tag);
      }
      tagIds.add(tag.id);
    }
    await jsonRequest(`/api/notes/${note.id}/metadata`, {
      method: "PATCH",
      body: JSON.stringify({
        expectedVersion: suggestion.expectedVersion,
        tagIds: [...tagIds],
      }),
    });
  }

  async function addSuggestedLink(suggestion: AiCleanupSuggestion) {
    if (!suggestion.targetNoteId || !suggestion.targetNoteTitle) return;
    const note = await jsonRequest<NoteDetail>(
      `/api/notes/${suggestion.noteId}`,
    );
    if (note.optimisticVersion !== suggestion.expectedVersion) {
      throw new Error("The note changed after this scan. Run cleanup again.");
    }
    const content: EditorDocument = {
      ...note.content,
      content: [
        ...(note.content.content ?? []),
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Related: " },
            {
              type: "mention",
              attrs: {
                id: suggestion.targetNoteId,
                mentionId: globalThis.crypto.randomUUID(),
                label: suggestion.targetNoteTitle,
              },
            },
          ],
        },
      ],
    };
    await jsonRequest(`/api/notes/${note.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        expectedVersion: suggestion.expectedVersion,
        content,
      }),
    });
  }

  async function chooseImportFiles(files: File[]) {
    setPending(true);
    setError(null);
    setMessage(null);
    setImportPreview(null);
    try {
      const markdownFiles = files.filter(({ name }) => /\.md$/i.test(name));
      if (markdownFiles.length === 0) {
        throw new Error("Choose one or more Markdown (.md) files.");
      }
      if (markdownFiles.length > MAX_MARKDOWN_IMPORT_FILES) {
        throw new Error(
          `Import up to ${MAX_MARKDOWN_IMPORT_FILES.toLocaleString()} Markdown files at a time.`,
        );
      }
      const values = await Promise.all(
        markdownFiles.map(async (file) => ({
          path:
            (file as File & { webkitRelativePath?: string })
              .webkitRelativePath || file.name,
          content: await file.text(),
        })),
      );
      const preview = await jsonRequest<ImportPreview>(
        "/api/imports/markdown",
        {
          method: "POST",
          body: JSON.stringify({ files: values, commit: false }),
        },
      );
      setImportFiles(values);
      setImportPreview(preview);
    } catch (importError) {
      setError(messageFrom(importError, "The files could not be read"));
    } finally {
      setPending(false);
    }
  }

  async function commitImport() {
    if (!importFiles.length) return;
    setPending(true);
    setError(null);
    try {
      if (!(await beforeAction())) return;
      const result = await jsonRequest<ImportPreview>("/api/imports/markdown", {
        method: "POST",
        body: JSON.stringify({ files: importFiles, commit: true }),
      });
      setImportPreview(result);
      setMessage(
        `Imported ${result.summary.created ?? 0} note(s); skipped ${result.summary.skipped ?? 0} already imported.`,
      );
      await onWorkspaceChanged();
      if (result.createdNoteIds?.[0]) openNote(result.createdNoteIds[0]);
    } catch (importError) {
      setError(messageFrom(importError, "The Markdown import failed"));
    } finally {
      setPending(false);
    }
  }

  const title = {
    home: "Command centre",
    capture: "Quick capture",
    templates: "Note templates",
    cleanup: "Workspace cleanup",
    import: "Import notes",
  }[view];

  return (
    <dialog
      ref={dialogRef}
      className="command-center-dialog"
      aria-labelledby="command-center-title"
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
        <div className="command-center-heading">
          {view !== "home" ? (
            <button
              type="button"
              className="icon-button"
              aria-label="Back to commands"
              onClick={() => navigate("home")}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
          ) : (
            <Command size={18} aria-hidden="true" />
          )}
          <div>
            <p>Linked Notes</p>
            <h2 id="command-center-title">{title}</h2>
          </div>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close command centre"
          disabled={pending}
          onClick={() => dialogRef.current?.close()}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      {error ? (
        <div className="dialog-message error-state" role="alert">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="dialog-message" role="status">
          <Check size={15} aria-hidden="true" />
          {message}
        </div>
      ) : null}

      <div className="command-center-body">
        {view === "home" ? (
          <>
            <label className="command-search">
              <Search size={17} aria-hidden="true" />
              <input
                ref={searchRef}
                aria-label="Search commands and notes"
                value={query}
                placeholder="Search commands or open a note…"
                onChange={(event) => setQuery(event.target.value)}
              />
              <kbd>⌘K</kbd>
            </label>
            {!query.trim() ? (
              <div className="command-grid">
                <CommandButton
                  icon={ClipboardPen}
                  title="Quick capture"
                  detail="Write without leaving your flow"
                  shortcut="⇧⌘N"
                  onClick={() => navigate("capture")}
                />
                <CommandButton
                  icon={CalendarDays}
                  title="Today's note"
                  detail="Open or create one note for today"
                  onClick={() => void openDaily()}
                />
                <CommandButton
                  icon={FilePlus2}
                  title="Templates"
                  detail="Create reusable note starting points"
                  onClick={() => navigate("templates")}
                />
                <CommandButton
                  icon={WandSparkles}
                  title="AI cleanup"
                  detail="Review links, duplicates, titles and tags"
                  onClick={() => navigate("cleanup")}
                />
                <CommandButton
                  icon={FileInput}
                  title="Import notes"
                  detail="Markdown folders or Apple Notes"
                  onClick={() => navigate("import")}
                />
                <CommandButton
                  icon={Download}
                  title="Export Markdown"
                  detail="Download the whole workspace and attachments"
                  onClick={() =>
                    window.location.assign("/api/exports/markdown")
                  }
                />
              </div>
            ) : null}
            <section className="command-note-results">
              <h3>{query.trim() ? "Matching notes" : "Recent notes"}</h3>
              {matchingNotes.length ? (
                matchingNotes.map((note) => (
                  <button
                    type="button"
                    key={note.id}
                    onClick={() => openNote(note.id)}
                  >
                    <FilePlus2 size={15} aria-hidden="true" />
                    <span>
                      <strong>{note.title || "Untitled Note"}</strong>
                      <small>{note.excerpt || "Empty note"}</small>
                    </span>
                    <ExternalLink size={14} aria-hidden="true" />
                  </button>
                ))
              ) : (
                <p>No notes match that search.</p>
              )}
            </section>
          </>
        ) : null}

        {view === "capture" ? (
          <form
            className="command-form"
            onSubmit={(event) => void createCapture(event)}
          >
            <label>
              Title
              <input
                autoFocus
                maxLength={500}
                value={captureTitle}
                placeholder="Optional title"
                onChange={(event) => setCaptureTitle(event.target.value)}
              />
            </label>
            <label>
              Note
              <textarea
                rows={10}
                maxLength={100_000}
                value={captureBody}
                placeholder="Capture the thought now; organise it later…"
                onChange={(event) => setCaptureBody(event.target.value)}
              />
            </label>
            <div className="dialog-actions">
              <button
                type="submit"
                disabled={
                  pending || (!captureTitle.trim() && !captureBody.trim())
                }
              >
                {pending ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <ClipboardPen size={15} />
                )}
                Save quick note
              </button>
            </div>
          </form>
        ) : null}

        {view === "templates" ? (
          <div className="command-section">
            <form
              className="inline-command-form"
              onSubmit={(event) => void createTemplate(event)}
            >
              <label>
                Save current note as a template
                <input
                  maxLength={200}
                  value={templateName}
                  placeholder={
                    currentNote ? "Template name" : "Open a note first"
                  }
                  disabled={!currentNote || pending}
                  onChange={(event) => setTemplateName(event.target.value)}
                />
              </label>
              <button
                type="submit"
                disabled={!currentNote || !templateName.trim() || pending}
              >
                Save template
              </button>
            </form>
            <div className="template-list">
              {templates.length ? (
                templates.map((template) => (
                  <article key={template.id}>
                    <div>
                      <strong>{template.name}</strong>
                      <small>{template.title || "No fixed title"}</small>
                    </div>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => void createFromTemplate(template.id)}
                    >
                      New note
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => void openDaily(template.id)}
                    >
                      Use today
                    </button>
                    <button
                      type="button"
                      className="danger-icon"
                      aria-label={`Delete ${template.name} template`}
                      disabled={pending}
                      onClick={() => void deleteTemplate(template.id)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </article>
                ))
              ) : (
                <p>No templates yet. Open a useful note and save it above.</p>
              )}
            </div>
          </div>
        ) : null}

        {view === "cleanup" ? (
          <div className="command-section">
            <div className="cleanup-intro">
              <Sparkles size={18} aria-hidden="true" />
              <div>
                <strong>Review-only local cleanup</strong>
                <p>
                  Ollama scans saved note text on this Mac. Nothing changes
                  until you accept a suggestion.
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => void scanCleanup()}
              >
                {pending ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <WandSparkles size={15} />
                )}
                {cleanup ? "Scan again" : "Scan workspace"}
              </button>
            </div>
            {cleanup ? (
              <div className="cleanup-results">
                <header>
                  <strong>{cleanup.suggestions.length} suggestions</strong>
                  <small>{cleanup.scannedNotes} notes scanned locally</small>
                </header>
                {cleanup.suggestions.length ? (
                  cleanup.suggestions.map((suggestion) => (
                    <CleanupCard
                      key={suggestion.id}
                      suggestion={suggestion}
                      pending={pending}
                      onOpen={openNote}
                      onApply={() => void applyCleanup(suggestion)}
                      onDismiss={() =>
                        setCleanup((current) =>
                          current
                            ? {
                                ...current,
                                suggestions: current.suggestions.filter(
                                  ({ id }) => id !== suggestion.id,
                                ),
                              }
                            : null,
                        )
                      }
                    />
                  ))
                ) : (
                  <p>No high-confidence cleanup suggestions were found.</p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {view === "import" ? (
          <div className="command-section">
            <div className="import-options">
              <label>
                <FileInput size={18} aria-hidden="true" />
                <strong>Choose Markdown files</strong>
                <span>
                  Preview up to {MAX_MARKDOWN_IMPORT_FILES.toLocaleString()} .md
                  files before importing.
                </span>
                <input
                  type="file"
                  aria-label="Choose Markdown files"
                  accept=".md,text/markdown"
                  multiple
                  disabled={pending}
                  onChange={(event) =>
                    void chooseImportFiles(Array.from(event.target.files ?? []))
                  }
                />
              </label>
              <label>
                <FolderInput size={18} aria-hidden="true" />
                <strong>Choose a Markdown folder</strong>
                <span>Nested folders become Linked Notes folders.</span>
                <input
                  type="file"
                  aria-label="Choose Markdown folder"
                  accept=".md,text/markdown"
                  multiple
                  disabled={pending}
                  {...({ webkitdirectory: "" } as Record<string, string>)}
                  onChange={(event) =>
                    void chooseImportFiles(Array.from(event.target.files ?? []))
                  }
                />
              </label>
            </div>
            <section className="apple-import-help">
              <header>
                <span aria-hidden="true"></span>
                <div>
                  <strong>Import Apple Notes on this Mac</strong>
                  <p>
                    Export through Apple Notes automation, then choose the
                    generated folder above. macOS will ask for permission the
                    first time.
                  </p>
                </div>
              </header>
              <code>
                npm run apple-notes:export --
                ~/Desktop/linked-notes-apple-import
              </code>
              <small>
                Accounts, folders, dates and note text are preserved. Saveable
                attachments are copied beside the Markdown and listed in the
                migration report.
              </small>
            </section>
            {importPreview ? (
              <section className="import-preview">
                <header>
                  <strong>{importPreview.summary.total} notes ready</strong>
                  <span>
                    {importPreview.summary.new} new ·{" "}
                    {importPreview.summary.existing} already imported
                    {importPreview.summary.appleNotes
                      ? ` · ${importPreview.summary.appleNotes} from Apple Notes`
                      : ""}
                  </span>
                </header>
                <div>
                  {importPreview.files.slice(0, 20).map((file) => (
                    <article key={file.path}>
                      <span data-state={file.status}>{file.status}</span>
                      <div>
                        <strong>{file.title}</strong>
                        <small>{file.folder || "Workspace root"}</small>
                      </div>
                    </article>
                  ))}
                  {importPreview.files.length > 20 ? (
                    <small>Plus {importPreview.files.length - 20} more…</small>
                  ) : null}
                </div>
                {!importPreview.committed ? (
                  <div className="dialog-actions">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => void commitImport()}
                    >
                      {pending ? (
                        <LoaderCircle className="spin" size={15} />
                      ) : (
                        <FileInput size={15} />
                      )}
                      Import new notes
                    </button>
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}

function CommandButton({
  icon: Icon,
  title,
  detail,
  shortcut,
  onClick,
}: {
  icon: typeof History;
  title: string;
  detail: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}>
      <Icon size={18} aria-hidden="true" />
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </button>
  );
}

function CleanupCard({
  suggestion,
  pending,
  onOpen,
  onApply,
  onDismiss,
}: {
  suggestion: AiCleanupSuggestion;
  pending: boolean;
  onOpen: (id: string) => void;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const labels = {
    duplicate: "Possible duplicate",
    "missing-tags": "Suggested tags",
    "clearer-title": "Clearer title",
    stale: "Stale note",
    "related-link": "Suggested link",
  };
  return (
    <article className="cleanup-card">
      <header>
        <span>{labels[suggestion.type]}</span>
        <small>{Math.round(suggestion.confidence * 100)}% confidence</small>
      </header>
      <strong>{suggestion.noteTitle}</strong>
      {suggestion.targetNoteTitle ? (
        <p>
          With <b>{suggestion.targetNoteTitle}</b>
        </p>
      ) : null}
      {suggestion.suggestedTitle ? (
        <p>
          Rename to <b>{suggestion.suggestedTitle}</b>
        </p>
      ) : null}
      {suggestion.suggestedTags.length ? (
        <div className="cleanup-tags">
          {suggestion.suggestedTags.map((tag) => (
            <span key={tag}>
              <Tags size={11} aria-hidden="true" />
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      <p>{suggestion.reason}</p>
      <footer>
        <button type="button" onClick={() => onOpen(suggestion.noteId)}>
          Open note
        </button>
        {suggestion.targetNoteId ? (
          <button
            type="button"
            onClick={() => onOpen(suggestion.targetNoteId!)}
          >
            Open related
          </button>
        ) : null}
        <button type="button" disabled={pending} onClick={onDismiss}>
          Dismiss
        </button>
        {suggestion.type !== "duplicate" ? (
          <button type="button" disabled={pending} onClick={onApply}>
            {suggestion.type === "stale"
              ? "Archive"
              : suggestion.type === "related-link"
                ? "Add link"
                : "Apply"}
          </button>
        ) : null}
      </footer>
    </article>
  );
}

async function jsonRequest<T = unknown>(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
  const payload = (await response.json()) as T | ApiError;
  if (
    !response.ok ||
    (payload && typeof payload === "object" && "error" in payload)
  ) {
    throw new Error(
      payload && typeof payload === "object" && "error" in payload
        ? (payload as ApiError).error.message
        : "The request failed",
    );
  }
  return payload as T;
}

function plainTextDocument(value: string): EditorDocument {
  const paragraphs = value.replaceAll("\r\n", "\n").split("\n");
  return {
    type: "doc",
    content: paragraphs.map((text) => ({
      type: "paragraph",
      ...(text ? { content: [{ type: "text", text }] } : {}),
    })),
  };
}

function firstLine(value: string) {
  return (
    value
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim()
      .slice(0, 500) || "Quick note"
  );
}

function normalize(value: string) {
  return value.trim().replaceAll(/\s+/g, " ").toLocaleLowerCase();
}

function messageFrom(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
