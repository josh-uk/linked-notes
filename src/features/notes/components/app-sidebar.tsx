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
  Sun,
  Trash2,
} from "lucide-react";
import { useTheme } from "next-themes";

import type { NotesView } from "../types";

type AppSidebarProps = {
  currentView: NotesView;
  onViewChange: (view: NotesView) => void;
  onOpenNotes: () => void;
};

const navigation = [
  { view: "all" as const, label: "All notes", icon: FileText },
  { view: "pinned" as const, label: "Pinned", icon: Pin },
  { label: "Folders", icon: FolderClosed, disabled: true },
  { label: "Tags", icon: Hash, disabled: true },
  { label: "Archive", icon: Archive, disabled: true },
  { view: "trash" as const, label: "Trash", icon: Trash2 },
];

export function AppSidebar({
  currentView,
  onViewChange,
  onOpenNotes,
}: AppSidebarProps) {
  const { theme, setTheme } = useTheme();
  const currentTheme = theme ?? "system";

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
        {navigation.map(({ label, icon: Icon, disabled, view }) => (
          <button
            type="button"
            key={label}
            className="sidebar-item"
            data-active={view === currentView || undefined}
            disabled={disabled}
            aria-current={view === currentView ? "page" : undefined}
            title={disabled ? `${label} arrives in Phase 3` : label}
            onClick={() => {
              if (view) {
                onViewChange(view);
                onOpenNotes();
              }
            }}
          >
            <Icon size={17} aria-hidden="true" />
            <span>{label}</span>
            {disabled ? <small>Soon</small> : null}
          </button>
        ))}
      </nav>

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
          disabled
          title="Settings arrive in Phase 3"
        >
          <Settings size={17} aria-hidden="true" />
          <span>Settings</span>
          <small>Soon</small>
        </button>
      </div>
    </aside>
  );
}
