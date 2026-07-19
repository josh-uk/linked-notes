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
  titleHighlight?: string;
  highlight?: string;
  rank?: number;
  optimisticVersion: number;
  folder: NoteFolder | null;
  tags: NoteTag[];
  attachmentCount: number;
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

export type NoteFolder = {
  id: string;
  name: string;
};

export type NoteTag = {
  id: string;
  displayName: string;
  color: string | null;
};

export type FolderSummary = NoteFolder & {
  parentId: string | null;
  sortOrder: number;
  noteCount: number;
  createdAt: string;
  updatedAt: string;
};

export type TagSummary = NoteTag & {
  normalizedName: string;
  noteCount: number;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationResponse = {
  folders: FolderSummary[];
  tags: TagSummary[];
  trashRetentionDays: number;
  maxFolderDepth: number;
};

export type NotesView = "all" | "pinned" | "archive" | "trash";
export type NoteSort = "updated" | "created" | "title" | "relevance";
export type SortDirection = "asc" | "desc";
export type AttachmentFilter = "any" | "with" | "without";

export type NotesPage = {
  items: NoteSummary[];
  nextCursor: string | null;
};

export type SearchPage = {
  items: NoteSummary[];
  nextOffset: number | null;
};

export type AttachmentItem = {
  id: string;
  noteId: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  width: number | null;
  height: number | null;
  createdAt: string;
  available: boolean;
  unavailableReason: "missing" | "size-mismatch" | null;
  downloadUrl: string;
  previewUrl: string | null;
};

export type AttachmentsPage = {
  items: AttachmentItem[];
  nextCursor: string | null;
};

export type NoteLifecycleAction =
  "pin" | "unpin" | "archive" | "unarchive" | "trash" | "restore";

export type BulkNoteAction =
  "pin" | "archive" | "trash" | "restore" | "move" | "tag";

export type ApiError = {
  error: {
    code: string;
    message: string;
    current?: NoteDetail;
  };
};
