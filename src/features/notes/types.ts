export type EditorMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type EditorNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: EditorNode[];
  marks?: EditorMark[];
  text?: string;
};

export type EditorDocument = EditorNode & {
  type: "doc";
};

export type NoteSummary = {
  id: string;
  title: string;
  excerpt: string;
  optimisticVersion: number;
  pinnedAt: string | null;
  archivedAt: string | null;
  trashedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NoteDetail = NoteSummary & {
  content: EditorDocument;
  contentSchema: number;
};

export type NotesView = "all" | "pinned" | "trash";

export type NotesPage = {
  items: NoteSummary[];
  nextCursor: string | null;
};

export type NoteLifecycleAction = "pin" | "unpin" | "trash" | "restore";

export type ApiError = {
  error: {
    code: string;
    message: string;
    current?: NoteDetail;
  };
};
