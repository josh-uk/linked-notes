DROP INDEX IF EXISTS "NoteLink_targetKey_updatedAt_idx";

CREATE INDEX "NoteLink_targetKey_updatedAt_sourceNoteId_mentionId_idx"
ON "NoteLink" (
  "targetKey",
  "updatedAt" DESC,
  "sourceNoteId",
  "mentionId"
);

DROP INDEX IF EXISTS "Note_archivedAt_trashedAt_updatedAt_idx";

CREATE INDEX "Note_archivedAt_trashedAt_updatedAt_id_idx"
ON "Note" (
  "archivedAt",
  "trashedAt",
  "updatedAt" DESC,
  "id" DESC
);
