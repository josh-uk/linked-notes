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
  mentionTargets: MentionTarget[];
};

export type MentionTargetState = "active" | "archived" | "trashed" | "missing";

export type MentionTarget = {
  id: string;
  title: string | null;
  state: MentionTargetState;
};

export type MentionSuggestion = {
  kind: "note";
  id: string;
  label: string;
  excerpt: string;
  updatedAt: string;
  isSelf: boolean;
};

export type MentionSuggestionError = {
  kind: "error";
  message: string;
};

export type MentionSuggestionItem = MentionSuggestion | MentionSuggestionError;

export type BacklinkContext = {
  mentionId: string;
  context: string;
};

export type BacklinkGroup = {
  sourceNoteId: string;
  sourceTitle: string;
  sourceState: Exclude<MentionTargetState, "missing">;
  sourceUpdatedAt: string;
  contexts: BacklinkContext[];
};

export type BacklinksResponse = {
  items: BacklinkGroup[];
  totalMentions: number;
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
