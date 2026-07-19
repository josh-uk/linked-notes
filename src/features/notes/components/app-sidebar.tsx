"use client";

import {
  Archive,
  FileText,
  FolderClosed,
  Hash,
  Monitor,
  Moon,
  Pin,
  Settings,
  SlidersHorizontal,
  Sun,
  Trash2,
} from "lucide-react";
import { useTheme } from "next-themes";

import type { FolderSummary, NotesView, OrganizationResponse } from "../types";

type AppSidebarProps = {
  currentView: NotesView;
  organization: OrganizationResponse | null;
  currentFolderId: string | null;
  currentTagId: string | null;
  onViewChange: (view: NotesView) => void;
  onFolderChange: (folderId: string) => void;
  onTagChange: (tagId: string) => void;
  onManageOrganization: (section: "folders" | "tags" | "settings") => void;
  onOpenNotes: () => void;
};

const navigation = [
  { view: "all" as const, label: "All notes", icon: FileText },
  { view: "pinned" as const, label: "Pinned", icon: Pin },
  { view: "archive" as const, label: "Archive", icon: Archive },
  { view: "trash" as const, label: "Trash", icon: Trash2 },
];

export function AppSidebar({
  currentView,
  organization,
  currentFolderId,
  currentTagId,
  onViewChange,
  onFolderChange,
  onTagChange,
  onManageOrganization,
  onOpenNotes,
}: AppSidebarProps) {
  const { theme, setTheme } = useTheme();
  const currentTheme = theme ?? "system";
  const folders = flattenFolders(organization?.folders ?? []);

  return (
    <aside className="app-sidebar" aria-label="Workspace navigation">
      <div className="brand-row">
        <div className="brand-mark" aria-hidden="true">
          LN
        </div>
        <div>
          <strong>Linked Notes</strong>
          <span>Local workspace</span>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="Notes views">
        {navigation.map(({ label, icon: Icon, view }) => (
          <button
            type="button"
            key={label}
            className="sidebar-item"
            data-active={
              view === currentView && !currentFolderId && !currentTagId
                ? true
                : undefined
            }
            aria-current={
              view === currentView && !currentFolderId && !currentTagId
                ? "page"
                : undefined
            }
            title={label}
            onClick={() => {
              onViewChange(view);
              onOpenNotes();
            }}
          >
            <Icon size={17} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <section className="sidebar-collection" aria-labelledby="folders-label">
        <div className="sidebar-section-heading">
          <span id="folders-label">
            <FolderClosed size={15} aria-hidden="true" />
            Folders
          </span>
          <button
            type="button"
            aria-label="Manage folders"
            title="Manage folders"
            onClick={() => onManageOrganization("folders")}
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
          </button>
        </div>
        <div className="sidebar-collection-items">
          {folders.length === 0 ? (
            <span className="sidebar-collection-empty">No folders yet</span>
          ) : (
            folders.map(({ folder, depth }) => (
              <button
                type="button"
                key={folder.id}
                className="sidebar-filter"
                data-active={folder.id === currentFolderId || undefined}
                style={{ paddingInlineStart: `${0.65 + depth * 0.8}rem` }}
                onClick={() => {
                  onFolderChange(folder.id);
                  onOpenNotes();
                }}
              >
                <FolderClosed size={13} aria-hidden="true" />
                <span>{folder.name}</span>
                <small>{folder.noteCount}</small>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="sidebar-collection" aria-labelledby="tags-label">
        <div className="sidebar-section-heading">
          <span id="tags-label">
            <Hash size={15} aria-hidden="true" />
            Tags
          </span>
          <button
            type="button"
            aria-label="Manage tags"
            title="Manage tags"
            onClick={() => onManageOrganization("tags")}
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
          </button>
        </div>
        <div className="sidebar-collection-items">
          {organization?.tags.length ? (
            organization.tags.map((tag) => (
              <button
                type="button"
                key={tag.id}
                className="sidebar-filter"
                data-active={tag.id === currentTagId || undefined}
                onClick={() => {
                  onTagChange(tag.id);
                  onOpenNotes();
                }}
              >
                <span
                  className="tag-dot"
                  style={{ backgroundColor: tag.color ?? "var(--subtle)" }}
                  aria-hidden="true"
                />
                <span>{tag.displayName}</span>
                <small>{tag.noteCount}</small>
              </button>
            ))
          ) : (
            <span className="sidebar-collection-empty">No tags yet</span>
          )}
        </div>
      </section>

      <div className="sidebar-bottom">
        <label className="theme-control">
          <span>Theme</span>
          <span className="theme-select-wrap" suppressHydrationWarning>
            {currentTheme === "light" ? (
              <Sun size={15} aria-hidden="true" />
            ) : null}
            {currentTheme === "dark" ? (
              <Moon size={15} aria-hidden="true" />
            ) : null}
            {currentTheme === "system" ? (
              <Monitor size={15} aria-hidden="true" />
            ) : null}
            <select
              aria-label="Colour theme"
              value={currentTheme}
              suppressHydrationWarning
              onChange={(event) => setTheme(event.target.value)}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </span>
        </label>
        <button
          type="button"
          className="sidebar-item"
          title="Workspace settings"
          onClick={() => onManageOrganization("settings")}
        >
          <Settings size={17} aria-hidden="true" />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}

function flattenFolders(folders: FolderSummary[]) {
  const result: Array<{ folder: FolderSummary; depth: number }> = [];
  const visited = new Set<string>();
  const visit = (parentId: string | null, depth: number) => {
    folders
      .filter((folder) => folder.parentId === parentId)
      .sort((left, right) =>
        left.sortOrder === right.sortOrder
          ? left.name.localeCompare(right.name)
          : left.sortOrder - right.sortOrder,
      )
      .forEach((folder) => {
        if (visited.has(folder.id)) return;
        visited.add(folder.id);
        result.push({ folder, depth });
        visit(folder.id, depth + 1);
      });
  };
  visit(null, 0);
  folders.forEach((folder) => {
    if (!visited.has(folder.id)) result.push({ folder, depth: 0 });
  });
  return result;
}
