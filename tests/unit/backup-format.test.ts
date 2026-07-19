import { describe, expect, it } from "vitest";

import type { EditorDocument } from "@/features/notes/types";
import {
  assertSafeArchivePath,
  attachmentArchivePath,
  canonicalManifestBytes,
  parseBackupManifest,
  remapEditorDocumentTargets,
  type BackupManifest,
} from "@/server/backups/backup-format";

const noteId = "11111111-1111-4111-8111-111111111111";
const targetId = "22222222-2222-4222-8222-222222222222";
const mentionId = "33333333-3333-4333-8333-333333333333";

describe("backup format", () => {
  it("accepts a relationally complete canonical manifest", () => {
    const manifest = minimalManifest();
    expect(parseBackupManifest(manifest)).toEqual(manifest);
    expect(canonicalManifestBytes(manifest).toString()).toBe(
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  });

  it.each([
    "../manifest.json",
    "/manifest.json",
    "attachments\\unsafe",
    "attachments//unsafe",
    "C:/unsafe",
    "attachments/./unsafe",
  ])("rejects traversal or non-canonical path %s", (value) => {
    expect(() => assertSafeArchivePath(value)).toThrowError(
      expect.objectContaining({ code: "BACKUP_PATH_UNSAFE" }),
    );
  });

  it("rejects missing relations and non-deterministic attachment paths", () => {
    const manifest = minimalManifest();
    manifest.entities.attachments[0]!.archivePath = "attachments/other";
    expect(() => parseBackupManifest(manifest)).toThrow();
  });

  it("rejects folder-name collisions and tag names with forged normalization", () => {
    const timestamp = "2026-07-19T10:00:00.000Z";
    const manifest = minimalManifest();
    manifest.entities.folders = [
      {
        id: "77777777-7777-4777-8777-777777777777",
        name: "Projects",
        parentId: null,
        sortOrder: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "88888888-8888-4888-8888-888888888888",
        name: "  PROJECTS  ",
        parentId: null,
        sortOrder: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];
    expect(() => parseBackupManifest(manifest)).toThrow();

    manifest.entities.folders = [];
    manifest.entities.tags = [
      {
        id: "99999999-9999-4999-8999-999999999999",
        displayName: "Portable Notes",
        normalizedName: "forged",
        color: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];
    expect(() => parseBackupManifest(manifest)).toThrow();
  });

  it("remaps durable mention targets without mutating the source document", () => {
    const manifest = minimalManifest();
    const document = manifest.entities.notes[0]!.content as EditorDocument;
    const replacement = "44444444-4444-4444-8444-444444444444";
    const remapped = remapEditorDocumentTargets(
      document,
      new Map([[targetId, replacement]]),
    );
    expect(remapped.content?.[0]?.content?.[0]?.attrs?.id).toBe(replacement);
    expect(document.content?.[0]?.content?.[0]?.attrs?.id).toBe(targetId);
  });
});

function minimalManifest(): BackupManifest {
  const timestamp = "2026-07-19T10:00:00.000Z";
  const content: EditorDocument = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "mention",
            attrs: { id: targetId, mentionId, label: "Missing target" },
          },
        ],
      },
    ],
  };
  const attachmentId = "55555555-5555-4555-8555-555555555555";
  return {
    format: "linked-notes-backup",
    backupSchemaVersion: 1,
    dataSchemaVersion: 1,
    applicationVersion: "1.0.0",
    createdAt: timestamp,
    entities: {
      schemaMetadata: {
        id: 1,
        dataSchemaVersion: 1,
        backupSchemaVersion: 1,
        updatedAt: timestamp,
      },
      folders: [],
      tags: [],
      notes: [
        {
          id: noteId,
          title: "Source",
          content,
          contentSchema: 1,
          optimisticVersion: 1,
          folderId: null,
          pinnedAt: null,
          archivedAt: null,
          trashedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      noteTags: [],
      noteLinks: [
        {
          sourceNoteId: noteId,
          targetNoteId: null,
          targetKey: targetId,
          mentionId,
          context: "@Missing target",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      settings: [],
      attachments: [
        {
          id: attachmentId,
          noteId,
          originalName: "data.bin",
          storageName: "66666666-6666-4666-8666-666666666666",
          archivePath: attachmentArchivePath(attachmentId),
          mimeType: "application/octet-stream",
          byteSize: 3,
          checksumSha256: "a".repeat(64),
          width: null,
          height: null,
          createdAt: timestamp,
        },
      ],
    },
  };
}
