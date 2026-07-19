"use client";

import {
  FolderClosed,
  Hash,
  Pencil,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";

import type {
  ApiError,
  FolderSummary,
  OrganizationResponse,
  TagSummary,
} from "../types";

type OrganizationSection = "folders" | "tags" | "settings";

type OrganizationDialogProps = {
  open: boolean;
  initialSection: OrganizationSection;
  organization: OrganizationResponse | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
};

export function OrganizationDialog({
  open,
  initialSection,
  organization,
  onClose,
  onChanged,
}: OrganizationDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
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

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setSection(initialSection);
      setError(null);
      setMessage(null);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [initialSection, open]);

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
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <header className="dialog-header">
        <div>
          <p>Workspace</p>
          <h2 id="organization-title">Organize notes</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close organization settings"
          onClick={onClose}
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
        </section>
      ) : null}
    </dialog>
  );
}
