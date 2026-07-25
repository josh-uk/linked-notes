ALTER TABLE "Note"
  ADD COLUMN "dailyDate" DATE,
  ADD COLUMN "sourceType" VARCHAR(50),
  ADD COLUMN "sourceId" VARCHAR(1000);

CREATE UNIQUE INDEX "Note_dailyDate_key" ON "Note"("dailyDate");
CREATE UNIQUE INDEX "Note_sourceType_sourceId_key" ON "Note"("sourceType", "sourceId");

CREATE TABLE "NoteRevision" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "noteId" UUID NOT NULL,
  "noteVersion" INTEGER NOT NULL,
  "title" VARCHAR(500) NOT NULL,
  "content" JSONB NOT NULL,
  "contentText" TEXT NOT NULL DEFAULT '',
  "reason" VARCHAR(32) NOT NULL DEFAULT 'edit',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NoteRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NoteRevision_noteId_fkey"
    FOREIGN KEY ("noteId") REFERENCES "Note"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NoteRevision_noteId_noteVersion_key"
  ON "NoteRevision"("noteId", "noteVersion");
CREATE INDEX "NoteRevision_noteId_createdAt_id_idx"
  ON "NoteRevision"("noteId", "createdAt" DESC, "id" DESC);

CREATE TABLE "NoteTemplate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" VARCHAR(200) NOT NULL,
  "title" VARCHAR(500) NOT NULL DEFAULT '',
  "content" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NoteTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NoteTemplate_name_key" ON "NoteTemplate"("name");
CREATE INDEX "NoteTemplate_updatedAt_id_idx"
  ON "NoteTemplate"("updatedAt" DESC, "id" DESC);

UPDATE "SchemaMetadata"
SET "dataSchemaVersion" = 2,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 1;
