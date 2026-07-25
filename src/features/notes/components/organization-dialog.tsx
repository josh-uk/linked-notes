"use client";

import {
  Download,
  FolderClosed,
  HardDrive,
  Hash,
  LoaderCircle,
  Pencil,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";

import type {
  AiFolderSuggestion,
  AiFolderSuggestionsResponse,
  ApiError,
  FolderSummary,
  OrganizationResponse,
  TagSummary,
} from "../types";
import { trapDialogFocus } from "./dialog-focus";

type OrganizationSection = "folders" | "tags" | "settings";

type OrganizationDialogProps = {
  open: boolean;
  initialSection: OrganizationSection;
  organization: OrganizationResponse | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
  beforeRestore: () => Promise<boolean>;
  onWorkspaceRestored: () => void;
};

type StorageReport = {
  metadataCount: number;
  storedFileCount: number;
  missingAttachmentIds: string[];
  corruptAttachmentIds: string[];
  orphanedStorageNames: string[];
  staleStagingNames: string[];
  repair: null | {
    orphanedBytes: { deleted: number; missing: number; failed: number };
    staleStagingFiles: number;
  };
};

type RestoreReport = {
  restored: true;
  mode: "merge" | "replace";
  source: { applicationVersion: string };
  archive: {
    compressedBytes: number;
    expandedBytes: number;
    entryCount: number;
  };
  summary: {
    foldersCreated: number;
    foldersMatched: number;
    tagsCreated: number;
    tagsMatched: number;
    notesCreated: number;
    noteIdsRemapped: number;
    attachmentsCreated: number;
    attachmentIdsRemapped: number;
    missingTargetKeysRemapped: number;
    settingsImported: number;
    revisionsImported: number;
    templatesImported: number;
  };
  safetyBackup: null | {
    name: string;
    byteSize: number;
    checksumSha256: string;
    downloadUrl: string;
  };
};

export function OrganizationDialog({
  open,
  initialSection,
  organization,
  onClose,
  onChanged,
  beforeRestore,
  onWorkspaceRestored,
}: OrganizationDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const restoreRequestRef = useRef<XMLHttpRequest | null>(null);
  const [section, setSection] = useState<OrganizationSection>(initialSection);
  const [folderName, setFolderName] = useState("");
  const [folderParentId, setFolderParentId] = useState("");
  const [editingFolder, setEditingFolder] = useState<FolderSummary | null>(
    null,
  );
  const [deletingFolder, setDeletingFolder] = useState<FolderSummary | null>(
    null,
  );
  const [folderDeleteStrategy, setFolderDeleteStrategy] = useState<
    "move-to-parent" | "trash-notes"
  >("move-to-parent");
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("#b06f4f");
  const [editingTag, setEditingTag] = useState<TagSummary | null>(null);
  const [deletingTag, setDeletingTag] = useState<TagSummary | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storageReport, setStorageReport] = useState<StorageReport | null>(
    null,
  );
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreMode, setRestoreMode] = useState<"merge" | "replace">("merge");
  const [replaceConfirmation, setReplaceConfirmation] = useState("");
  const [restoreProgress, setRestoreProgress] = useState<number | null>(null);
  const [restoreReport, setRestoreReport] = useState<RestoreReport | null>(
    null,
  );
  const [folderSuggestions, setFolderSuggestions] =
    useState<AiFolderSuggestionsResponse | null>(null);
  const [selectedFolderSuggestionIds, setSelectedFolderSuggestionIds] =
    useState<string[]>([]);
  const [folderAiPending, setFolderAiPending] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setSection(initialSection);
      setError(null);
      setMessage(null);
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      dialog.showModal();
      requestAnimationFrame(() => closeButtonRef.current?.focus());
    }
    if (!open && dialog.open) dialog.close();
  }, [initialSection, open]);

  useEffect(
    () => () => {
      restoreRequestRef.current?.abort();
    },
    [],
  );

  async function request(url: string, init: RequestInit) {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(url, {
        ...init,
        headers: { "Content-Type": "application/json", ...init.headers },
      });
      const payload = (await response.json()) as unknown | ApiError;
      if (
        !response.ok ||
        (payload && typeof payload === "object" && "error" in payload)
      ) {
        throw new Error(
          payload && typeof payload === "object" && "error" in payload
            ? (payload as ApiError).error.message
            : "The organization change failed",
        );
      }
      await onChanged();
      setFolderSuggestions(null);
      setSelectedFolderSuggestionIds([]);
      setMessage("Workspace organization updated.");
      return true;
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The organization change failed",
      );
      return false;
    } finally {
      setPending(false);
    }
  }

  async function saveFolder(event: FormEvent) {
    event.preventDefault();
    const success = await request(
      editingFolder ? `/api/folders/${editingFolder.id}` : "/api/folders",
      {
        method: editingFolder ? "PATCH" : "POST",
        body: JSON.stringify({
          name: folderName,
          parentId: folderParentId || null,
        }),
      },
    );
    if (success) resetFolderForm();
  }

  async function confirmDeleteFolder() {
    if (!deletingFolder) return;
    const success = await request(`/api/folders/${deletingFolder.id}`, {
      method: "DELETE",
      body: JSON.stringify({ strategy: folderDeleteStrategy }),
    });
    if (success) setDeletingFolder(null);
  }

  async function saveTag(event: FormEvent) {
    event.preventDefault();
    const success = await request(
      editingTag ? `/api/tags/${editingTag.id}` : "/api/tags",
      {
        method: editingTag ? "PATCH" : "POST",
        body: JSON.stringify({ name: tagName, color: tagColor }),
      },
    );
    if (success) resetTagForm();
  }

  async function confirmDeleteTag() {
    if (!deletingTag) return;
    const success = await request(`/api/tags/${deletingTag.id}`, {
      method: "DELETE",
    });
    if (success) setDeletingTag(null);
  }

  async function setRetention(days: number) {
    await request("/api/settings/trash-retention", {
      method: "PATCH",
      body: JSON.stringify({ days }),
    });
  }

  async function suggestFolders() {
    setFolderAiPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/ai/folders/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = (await response.json()) as
        AiFolderSuggestionsResponse | ApiError;
      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload
            ? payload.error.message
            : "Folder suggestions could not be generated",
        );
      }
      setFolderSuggestions(payload);
      setSelectedFolderSuggestionIds(
        payload.suggestions
          .filter(({ confidence }) => confidence >= 0.45)
          .map(({ noteId }) => noteId),
      );
    } catch (suggestionError) {
      setError(
        suggestionError instanceof Error
          ? suggestionError.message
          : "Folder suggestions could not be generated",
      );
    } finally {
      setFolderAiPending(false);
    }
  }

  async function applyFolderSuggestions() {
    if (!folderSuggestions || selectedFolderSuggestionIds.length === 0) return;
    setFolderAiPending(true);
    setError(null);
    setMessage(null);
    try {
      const selected = folderSuggestions.suggestions.filter(({ noteId }) =>
        selectedFolderSuggestionIds.includes(noteId),
      );
      const byFolder = new Map<string, AiFolderSuggestion[]>();
      for (const suggestion of selected) {
        byFolder.set(suggestion.folderId, [
          ...(byFolder.get(suggestion.folderId) ?? []),
          suggestion,
        ]);
      }
      for (const [folderId, suggestions] of byFolder) {
        for (let index = 0; index < suggestions.length; index += 100) {
          const batch = suggestions.slice(index, index + 100);
          const response = await fetch("/api/notes/bulk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "move",
              folderId,
              notes: batch.map(({ noteId, expectedVersion }) => ({
                id: noteId,
                expectedVersion,
              })),
            }),
          });
          const payload = (await response.json()) as unknown | ApiError;
          if (
            !response.ok ||
            (payload && typeof payload === "object" && "error" in payload)
          ) {
            throw new Error(
              payload && typeof payload === "object" && "error" in payload
                ? (payload as ApiError).error.message
                : "The selected folder moves could not be applied",
            );
          }
        }
      }
      await onChanged();
      setMessage(
        `${selected.length} note${selected.length === 1 ? "" : "s"} moved into reviewed folders.`,
      );
      setFolderSuggestions(null);
      setSelectedFolderSuggestionIds([]);
    } catch (applyError) {
      setError(
        applyError instanceof Error
          ? applyError.message
          : "The selected folder moves could not be applied",
      );
    } finally {
      setFolderAiPending(false);
    }
  }

  function changeSuggestedFolder(
    suggestion: AiFolderSuggestion,
    folderId: string,
  ) {
    const folder = organization?.folders.find(({ id }) => id === folderId);
    if (!folder) return;
    setFolderSuggestions((current) =>
      current
        ? {
            ...current,
            suggestions: current.suggestions.map((item) =>
              item.noteId === suggestion.noteId
                ? {
                    ...item,
                    folderId: folder.id,
                    folderName: folder.name,
                    reason: "Folder changed during review.",
                  }
                : item,
            ),
          }
        : current,
    );
  }

  async function checkAttachmentStorage(repairOrphans = false) {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/attachments/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repairOrphans }),
      });
      const payload = (await response.json()) as StorageReport | ApiError;
      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload
            ? payload.error.message
            : "Attachment storage could not be checked",
        );
      }
      setStorageReport(payload);
      setMessage(
        repairOrphans
          ? "Unreferenced attachment bytes were reconciled."
          : "Attachment storage check complete.",
      );
    } catch (storageError) {
      setError(
        storageError instanceof Error
          ? storageError.message
          : "Attachment storage could not be checked",
      );
    } finally {
      setPending(false);
    }
  }

  async function restoreBackup() {
    if (!restoreFile || !(await beforeRestore())) return;
    setPending(true);
    setError(null);
    setMessage(null);
    setRestoreReport(null);
    setRestoreProgress(0);
    try {
      const query = new URLSearchParams({ mode: restoreMode });
      if (restoreMode === "replace") query.set("confirmation", "REPLACE");
      const report = await uploadRestoreArchive(
        `/api/backups/restore?${query}`,
        restoreFile,
        (progress) => setRestoreProgress(progress),
        (request) => {
          restoreRequestRef.current = request;
        },
      );
      setRestoreReport(report);
      setRestoreFile(null);
      setReplaceConfirmation("");
      if (restoreInputRef.current) restoreInputRef.current.value = "";
      setMessage(
        report.mode === "replace"
          ? "Workspace replaced. A safety backup is ready; reload when you have saved it."
          : "Backup merged. Reload the workspace to show imported notes.",
      );
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? restoreError.message
          : "The backup could not be restored",
      );
    } finally {
      restoreRequestRef.current = null;
      setRestoreProgress(null);
      setPending(false);
    }
  }

  function resetFolderForm() {
    setFolderName("");
    setFolderParentId("");
    setEditingFolder(null);
  }

  function resetTagForm() {
    setTagName("");
    setTagColor("#b06f4f");
    setEditingTag(null);
  }

  return (
    <dialog
      ref={dialogRef}
      className="organization-dialog"
      aria-labelledby="organization-title"
      onKeyDown={trapDialogFocus}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending && !folderAiPending) dialogRef.current?.close();
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
          <p>Workspace</p>
          <h2 id="organization-title">Organize notes</h2>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          className="icon-button"
          disabled={pending || folderAiPending}
          aria-label="Close organization settings"
          onClick={() => dialogRef.current?.close()}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <div
        className="organization-tabs"
        role="tablist"
        aria-label="Organization sections"
      >
        {(
          [
            ["folders", "Folders", FolderClosed],
            ["tags", "Tags", Hash],
            ["settings", "Settings", Settings],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            type="button"
            role="tab"
            aria-selected={section === value}
            key={value}
            onClick={() => setSection(value)}
          >
            <Icon size={15} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="dialog-message error-state" role="alert">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="dialog-message" role="status">
          {message}
        </div>
      ) : null}

      {section === "folders" ? (
        <section
          className="organization-panel"
          role="tabpanel"
          aria-label="Folders"
        >
          {deletingFolder ? (
            <div
              className="destructive-choice"
              role="group"
              aria-labelledby="delete-folder-title"
            >
              <h3 id="delete-folder-title">Delete “{deletingFolder.name}”?</h3>
              <p>Choose exactly what happens to its notes and child folders.</p>
              <label>
                <input
                  type="radio"
                  name="folder-delete-strategy"
                  checked={folderDeleteStrategy === "move-to-parent"}
                  onChange={() => setFolderDeleteStrategy("move-to-parent")}
                />
                Move its notes and child folders to the parent
              </label>
              <label>
                <input
                  type="radio"
                  name="folder-delete-strategy"
                  checked={folderDeleteStrategy === "trash-notes"}
                  onChange={() => setFolderDeleteStrategy("trash-notes")}
                />
                Trash notes in the whole subtree and remove its folders
              </label>
              <div className="dialog-actions">
                <button type="button" onClick={() => setDeletingFolder(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="danger-button"
                  disabled={pending}
                  onClick={() => void confirmDeleteFolder()}
                >
                  Delete folder
                </button>
              </div>
            </div>
          ) : (
            <>
              <form
                className="organization-form"
                onSubmit={(event) => void saveFolder(event)}
              >
                <label>
                  Folder name
                  <input
                    required
                    maxLength={200}
                    value={folderName}
                    onChange={(event) => setFolderName(event.target.value)}
                  />
                </label>
                <label>
                  Parent folder
                  <select
                    value={folderParentId}
                    onChange={(event) => setFolderParentId(event.target.value)}
                  >
                    <option value="">Top level</option>
                    {organization?.folders
                      .filter((folder) => folder.id !== editingFolder?.id)
                      .map((folder) => (
                        <option value={folder.id} key={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="dialog-actions">
                  {editingFolder ? (
                    <button type="button" onClick={resetFolderForm}>
                      Cancel edit
                    </button>
                  ) : null}
                  <button
                    type="submit"
                    disabled={pending || !folderName.trim()}
                  >
                    <Plus size={15} aria-hidden="true" />
                    {editingFolder ? "Save folder" : "Add folder"}
                  </button>
                </div>
              </form>
              <p className="organization-hint">
                Maximum depth: {organization?.maxFolderDepth ?? 6}. Cycles and
                invalid parents are rejected.
              </p>
              <section
                className="ai-folder-cleanup"
                aria-labelledby="ai-folder-cleanup-title"
              >
                <header>
                  <div>
                    <Sparkles size={17} aria-hidden="true" />
                    <span>
                      <strong id="ai-folder-cleanup-title">
                        Clean up unfiled notes
                      </strong>
                      <small>
                        Local embeddings suggest an existing folder. You review
                        every move.
                      </small>
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={
                      folderAiPending || !(organization?.folders.length ?? 0)
                    }
                    onClick={() => void suggestFolders()}
                  >
                    {folderAiPending && !folderSuggestions ? (
                      <LoaderCircle
                        className="spin"
                        size={15}
                        aria-hidden="true"
                      />
                    ) : (
                      <Sparkles size={15} aria-hidden="true" />
                    )}
                    {folderSuggestions ? "Scan again" : "Suggest folders"}
                  </button>
                </header>

                {folderSuggestions ? (
                  <>
                    <div className="ai-folder-summary" role="status">
                      <span>
                        {folderSuggestions.suggestions.length} suggestion
                        {folderSuggestions.suggestions.length === 1
                          ? ""
                          : "s"}{" "}
                        from {folderSuggestions.scannedNotes} unfiled note
                        {folderSuggestions.scannedNotes === 1 ? "" : "s"}
                      </span>
                      {folderSuggestions.scanLimitReached ? (
                        <small>
                          Safety limit reached; the most recently updated notes
                          and folders were scanned.
                        </small>
                      ) : null}
                    </div>
                    {folderSuggestions.suggestions.length > 0 ? (
                      <>
                        <div className="ai-folder-select-all">
                          <label>
                            <input
                              type="checkbox"
                              checked={
                                selectedFolderSuggestionIds.length ===
                                folderSuggestions.suggestions.length
                              }
                              onChange={(event) =>
                                setSelectedFolderSuggestionIds(
                                  event.target.checked
                                    ? folderSuggestions.suggestions.map(
                                        ({ noteId }) => noteId,
                                      )
                                    : [],
                                )
                              }
                            />
                            Select all
                          </label>
                          <small>Suggestions below 45% start unselected.</small>
                        </div>
                        <div className="ai-folder-suggestions">
                          {folderSuggestions.suggestions.map((suggestion) => (
                            <article key={suggestion.noteId}>
                              <input
                                type="checkbox"
                                aria-label={`Move ${suggestion.noteTitle}`}
                                checked={selectedFolderSuggestionIds.includes(
                                  suggestion.noteId,
                                )}
                                onChange={(event) =>
                                  setSelectedFolderSuggestionIds((current) =>
                                    event.target.checked
                                      ? [...current, suggestion.noteId]
                                      : current.filter(
                                          (id) => id !== suggestion.noteId,
                                        ),
                                  )
                                }
                              />
                              <div>
                                <strong>{suggestion.noteTitle}</strong>
                                <small>{suggestion.reason}</small>
                              </div>
                              <label>
                                <span className="sr-only">
                                  Suggested folder for {suggestion.noteTitle}
                                </span>
                                <select
                                  value={suggestion.folderId}
                                  onChange={(event) =>
                                    changeSuggestedFolder(
                                      suggestion,
                                      event.target.value,
                                    )
                                  }
                                >
                                  {organization?.folders.map((folder) => (
                                    <option key={folder.id} value={folder.id}>
                                      {folder.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <span>
                                {Math.round(suggestion.confidence * 100)}%
                              </span>
                            </article>
                          ))}
                        </div>
                        <div className="dialog-actions">
                          <button
                            type="button"
                            disabled={
                              folderAiPending ||
                              selectedFolderSuggestionIds.length === 0
                            }
                            onClick={() => void applyFolderSuggestions()}
                          >
                            {folderAiPending ? (
                              <LoaderCircle
                                className="spin"
                                size={15}
                                aria-hidden="true"
                              />
                            ) : null}
                            Apply {selectedFolderSuggestionIds.length} reviewed
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="ai-empty-result">
                        No non-empty unfiled notes need a suggestion.
                      </p>
                    )}
                  </>
                ) : null}
              </section>
              <ul className="organization-list">
                {organization?.folders.map((folder) => (
                  <li key={folder.id}>
                    <span>
                      <FolderClosed size={15} aria-hidden="true" />
                      <strong>{folder.name}</strong>
                      <small>{folder.noteCount} notes</small>
                    </span>
                    <span>
                      <button
                        type="button"
                        aria-label={`Edit folder ${folder.name}`}
                        onClick={() => {
                          setEditingFolder(folder);
                          setFolderName(folder.name);
                          setFolderParentId(folder.parentId ?? "");
                        }}
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete folder ${folder.name}`}
                        onClick={() => setDeletingFolder(folder)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ) : null}

      {section === "tags" ? (
        <section
          className="organization-panel"
          role="tabpanel"
          aria-label="Tags"
        >
          {deletingTag ? (
            <div className="destructive-choice">
              <h3>Delete “{deletingTag.displayName}”?</h3>
              <p>
                The tag will be removed from every note; the notes are not
                deleted.
              </p>
              <div className="dialog-actions">
                <button type="button" onClick={() => setDeletingTag(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="danger-button"
                  disabled={pending}
                  onClick={() => void confirmDeleteTag()}
                >
                  Delete tag
                </button>
              </div>
            </div>
          ) : (
            <>
              <form
                className="organization-form tag-form"
                onSubmit={(event) => void saveTag(event)}
              >
                <label>
                  Tag name
                  <input
                    required
                    maxLength={100}
                    value={tagName}
                    onChange={(event) => setTagName(event.target.value)}
                  />
                </label>
                <label>
                  Colour
                  <input
                    type="color"
                    value={tagColor}
                    onChange={(event) => setTagColor(event.target.value)}
                  />
                </label>
                <div className="dialog-actions">
                  {editingTag ? (
                    <button type="button" onClick={resetTagForm}>
                      Cancel edit
                    </button>
                  ) : null}
                  <button type="submit" disabled={pending || !tagName.trim()}>
                    <Plus size={15} aria-hidden="true" />
                    {editingTag ? "Save tag" : "Add tag"}
                  </button>
                </div>
              </form>
              <ul className="organization-list">
                {organization?.tags.map((tag) => (
                  <li key={tag.id}>
                    <span>
                      <span
                        className="tag-dot"
                        style={{
                          backgroundColor: tag.color ?? "var(--subtle)",
                        }}
                      />
                      <strong>{tag.displayName}</strong>
                      <small>{tag.noteCount} notes</small>
                    </span>
                    <span>
                      <button
                        type="button"
                        aria-label={`Edit tag ${tag.displayName}`}
                        onClick={() => {
                          setEditingTag(tag);
                          setTagName(tag.displayName);
                          setTagColor(tag.color ?? "#b06f4f");
                        }}
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete tag ${tag.displayName}`}
                        onClick={() => setDeletingTag(tag)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ) : null}

      {section === "settings" ? (
        <section
          className="organization-panel settings-panel"
          role="tabpanel"
          aria-label="Settings"
        >
          <label>
            Automatically delete notes after time in trash
            <select
              value={organization?.trashRetentionDays ?? 0}
              disabled={pending}
              onChange={(event) =>
                void setRetention(Number(event.target.value))
              }
            >
              <option value={0}>Never (recommended)</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={365}>1 year</option>
            </select>
          </label>
          <p>
            The default is never. Choosing a retention period permanently
            removes expired trashed notes and leaves inbound mentions visibly
            broken.
          </p>
          <div className="storage-check">
            <h3>
              <HardDrive size={16} aria-hidden="true" /> Attachment storage
            </h3>
            <p>
              Verify recorded sizes and checksums, identify missing bytes, and
              find files that no database row references.
            </p>
            <button
              type="button"
              disabled={pending}
              onClick={() => void checkAttachmentStorage(false)}
            >
              Check attachment storage
            </button>
            {storageReport ? (
              <div className="storage-report" role="status">
                <span>{storageReport.metadataCount} metadata rows</span>
                <span>{storageReport.storedFileCount} stored files</span>
                <span>
                  {storageReport.missingAttachmentIds.length} missing ·{" "}
                  {storageReport.corruptAttachmentIds.length} corrupt
                </span>
                <span>
                  {storageReport.orphanedStorageNames.length} orphaned ·{" "}
                  {storageReport.staleStagingNames.length} stale uploads
                </span>
                {storageReport.orphanedStorageNames.length > 0 ||
                storageReport.staleStagingNames.length > 0 ? (
                  <button
                    type="button"
                    className="danger-button"
                    disabled={pending}
                    onClick={() => void checkAttachmentStorage(true)}
                  >
                    Remove unreferenced bytes
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="backup-tools">
            <h3>
              <Download size={16} aria-hidden="true" /> Portable backup
            </h3>
            <p>
              Download a versioned archive containing the complete workspace and
              attachment bytes. Database and files are checksummed together.
            </p>
            <a className="backup-download" href="/api/backups" download>
              <Download size={15} aria-hidden="true" /> Download full backup
            </a>

            <div className="restore-form" aria-labelledby="restore-title">
              <h3 id="restore-title">
                <Upload size={16} aria-hidden="true" /> Restore a backup
              </h3>
              <p>
                The complete archive is staged and validated before the live
                workspace changes. Merge keeps current data; replace creates a
                downloadable safety backup first.
              </p>
              <label>
                Backup archive
                <input
                  ref={restoreInputRef}
                  type="file"
                  accept=".gz,.tgz,.tar.gz,.linked-notes-backup.tar.gz,application/gzip"
                  disabled={pending}
                  onChange={(event) => {
                    setRestoreFile(event.target.files?.[0] ?? null);
                    setRestoreReport(null);
                    setError(null);
                  }}
                />
              </label>
              <label>
                Restore mode
                <select
                  value={restoreMode}
                  disabled={pending}
                  onChange={(event) => {
                    setRestoreMode(event.target.value as "merge" | "replace");
                    setReplaceConfirmation("");
                  }}
                >
                  <option value="merge">Merge with this workspace</option>
                  <option value="replace">Replace this workspace</option>
                </select>
              </label>
              {restoreMode === "replace" ? (
                <label className="replace-confirmation">
                  Type REPLACE to confirm permanent workspace replacement
                  <input
                    value={replaceConfirmation}
                    autoComplete="off"
                    disabled={pending}
                    onChange={(event) =>
                      setReplaceConfirmation(event.target.value)
                    }
                  />
                </label>
              ) : null}
              {restoreFile ? (
                <small>
                  Selected: {restoreFile.name} · {formatBytes(restoreFile.size)}
                </small>
              ) : null}
              {restoreProgress !== null ? (
                <div className="restore-progress" role="status">
                  <progress value={restoreProgress} max={100}>
                    {restoreProgress}%
                  </progress>
                  <span>
                    {restoreProgress < 100
                      ? `${restoreProgress}% uploaded`
                      : "Validating and restoring…"}
                  </span>
                </div>
              ) : null}
              <button
                type="button"
                disabled={
                  pending ||
                  !restoreFile ||
                  (restoreMode === "replace" &&
                    replaceConfirmation !== "REPLACE")
                }
                onClick={() => void restoreBackup()}
              >
                <Upload size={15} aria-hidden="true" />
                {pending ? "Restoring…" : "Validate and restore"}
              </button>
              {pending && restoreProgress !== null ? (
                <button
                  type="button"
                  onClick={() => restoreRequestRef.current?.abort()}
                >
                  Cancel restore
                </button>
              ) : null}
              {restoreReport ? (
                <div className="restore-report" role="status">
                  <strong>Restore complete</strong>
                  <span>
                    {restoreReport.summary.notesCreated} notes ·{" "}
                    {restoreReport.summary.attachmentsCreated} attachments ·{" "}
                    {restoreReport.summary.revisionsImported} history versions ·{" "}
                    {restoreReport.summary.templatesImported} templates
                  </span>
                  <span>
                    {formatBytes(restoreReport.archive.compressedBytes)} archive
                    · {restoreReport.archive.entryCount} entries validated
                  </span>
                  {restoreReport.safetyBackup ? (
                    <a href={restoreReport.safetyBackup.downloadUrl} download>
                      <Download size={14} aria-hidden="true" /> Download safety
                      backup
                    </a>
                  ) : null}
                  <button type="button" onClick={onWorkspaceRestored}>
                    Reload workspace
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </dialog>
  );
}

function uploadRestoreArchive(
  url: string,
  file: File,
  onProgress: (progress: number) => void,
  onRequest: (request: XMLHttpRequest) => void,
) {
  return new Promise<RestoreReport>((resolve, reject) => {
    const request = new XMLHttpRequest();
    onRequest(request);
    request.open("POST", url);
    request.setRequestHeader("Content-Type", "application/gzip");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(
          Math.min(100, Math.round((event.loaded / event.total) * 100)),
        );
      }
    };
    request.onload = () => {
      try {
        const payload = JSON.parse(request.responseText) as
          RestoreReport | ApiError;
        if (
          request.status < 200 ||
          request.status >= 300 ||
          "error" in payload
        ) {
          reject(
            new Error(
              "error" in payload
                ? payload.error.message
                : "The backup could not be restored",
            ),
          );
          return;
        }
        onProgress(100);
        resolve(payload);
      } catch {
        reject(new Error("The restore returned an invalid response"));
      }
    };
    request.onerror = () => reject(new Error("The restore was interrupted"));
    request.onabort = () => reject(new Error("Restore cancelled"));
    request.send(file);
  });
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MiB`;
  return `${(bytes / 1_073_741_824).toFixed(1)} GiB`;
}
