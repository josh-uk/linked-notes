ALTER TABLE "NoteLink" ADD COLUMN "targetKey" UUID;

UPDATE "NoteLink" SET "targetKey" = "targetNoteId";

ALTER TABLE "NoteLink" ALTER COLUMN "targetKey" SET NOT NULL;
ALTER TABLE "NoteLink" ALTER COLUMN "targetNoteId" DROP NOT NULL;

ALTER TABLE "NoteLink" DROP CONSTRAINT "NoteLink_targetNoteId_fkey";

ALTER TABLE "NoteLink"
  ADD CONSTRAINT "NoteLink_targetNoteId_fkey"
  FOREIGN KEY ("targetNoteId") REFERENCES "Note"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "NoteLink_targetKey_updatedAt_idx"
  ON "NoteLink"("targetKey", "updatedAt" DESC);
