CREATE TYPE "SettingType" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'JSON');

CREATE TABLE "Folder" (
  "id" UUID NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "parentId" UUID,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Note" (
  "id" UUID NOT NULL,
  "title" VARCHAR(500) NOT NULL DEFAULT '',
  "content" JSONB NOT NULL,
  "contentText" TEXT NOT NULL DEFAULT '',
  "contentHtml" TEXT NOT NULL DEFAULT '',
  "contentSchema" INTEGER NOT NULL DEFAULT 1,
  "optimisticVersion" INTEGER NOT NULL DEFAULT 1,
  "folderId" UUID,
  "pinnedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "trashedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Tag" (
  "id" UUID NOT NULL,
  "normalizedName" VARCHAR(100) NOT NULL,
  "displayName" VARCHAR(100) NOT NULL,
  "color" VARCHAR(20),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NoteTag" (
  "noteId" UUID NOT NULL,
  "tagId" UUID NOT NULL,
  CONSTRAINT "NoteTag_pkey" PRIMARY KEY ("noteId", "tagId")
);

CREATE TABLE "NoteLink" (
  "sourceNoteId" UUID NOT NULL,
  "targetNoteId" UUID NOT NULL,
  "mentionId" UUID NOT NULL,
  "context" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NoteLink_pkey" PRIMARY KEY ("sourceNoteId", "mentionId")
);

CREATE TABLE "Attachment" (
  "id" UUID NOT NULL,
  "noteId" UUID NOT NULL,
  "originalName" VARCHAR(500) NOT NULL,
  "storageName" VARCHAR(100) NOT NULL,
  "mimeType" VARCHAR(255) NOT NULL,
  "byteSize" BIGINT NOT NULL,
  "checksumSha256" CHAR(64) NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Setting" (
  "key" VARCHAR(100) NOT NULL,
  "type" "SettingType" NOT NULL,
  "value" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "SchemaMetadata" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "dataSchemaVersion" INTEGER NOT NULL DEFAULT 1,
  "backupSchemaVersion" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchemaMetadata_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchemaMetadata_singleton" CHECK ("id" = 1)
);

CREATE UNIQUE INDEX "Folder_parentId_name_key" ON "Folder"("parentId", "name");
CREATE INDEX "Folder_parentId_sortOrder_idx" ON "Folder"("parentId", "sortOrder");
CREATE INDEX "Note_folderId_updatedAt_idx" ON "Note"("folderId", "updatedAt" DESC);
CREATE INDEX "Note_pinnedAt_updatedAt_idx" ON "Note"("pinnedAt", "updatedAt" DESC);
CREATE INDEX "Note_archivedAt_trashedAt_updatedAt_idx" ON "Note"("archivedAt", "trashedAt", "updatedAt" DESC);
CREATE UNIQUE INDEX "Tag_normalizedName_key" ON "Tag"("normalizedName");
CREATE INDEX "NoteTag_tagId_noteId_idx" ON "NoteTag"("tagId", "noteId");
CREATE INDEX "NoteLink_targetNoteId_updatedAt_idx" ON "NoteLink"("targetNoteId", "updatedAt" DESC);
CREATE INDEX "NoteLink_sourceNoteId_targetNoteId_idx" ON "NoteLink"("sourceNoteId", "targetNoteId");
CREATE UNIQUE INDEX "Attachment_storageName_key" ON "Attachment"("storageName");
CREATE INDEX "Attachment_noteId_createdAt_idx" ON "Attachment"("noteId", "createdAt");
CREATE INDEX "Attachment_checksumSha256_idx" ON "Attachment"("checksumSha256");

ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Folder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Note" ADD CONSTRAINT "Note_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NoteTag" ADD CONSTRAINT "NoteTag_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NoteTag" ADD CONSTRAINT "NoteTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NoteLink" ADD CONSTRAINT "NoteLink_sourceNoteId_fkey" FOREIGN KEY ("sourceNoteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NoteLink" ADD CONSTRAINT "NoteLink_targetNoteId_fkey" FOREIGN KEY ("targetNoteId") REFERENCES "Note"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "SchemaMetadata" ("id", "dataSchemaVersion", "backupSchemaVersion", "updatedAt") VALUES (1, 1, 1, CURRENT_TIMESTAMP);
