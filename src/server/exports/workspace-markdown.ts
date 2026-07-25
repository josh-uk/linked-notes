import { PassThrough } from "node:stream";
import { createGzip } from "node:zlib";

import * as tar from "tar-stream";

import {
  openStoredFile,
  sanitizeDisplayFilename,
} from "@/server/attachments/attachment-storage";
import { prisma } from "@/server/db";
import { resolveMentionTargets } from "@/server/notes/note-links";

import { renderNoteMarkdown } from "./markdown";

const ARCHIVE_EPOCH = new Date(0);

export async function createWorkspaceMarkdownExport() {
  const [notes, folders] = await Promise.all([
    prisma.note.findMany({
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      include: {
        attachments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
    }),
    prisma.folder.findMany({ orderBy: { id: "asc" } }),
  ]);
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const pack = tar.pack();
  const gzip = createGzip({ level: 6 });
  const output = new PassThrough();
  pack.pipe(gzip).pipe(output);

  void (async () => {
    try {
      for (const note of notes) {
        const directory = noteDirectory(note, folderById);
        const filename = `${safeSegment(note.title || "Untitled Note", 140)}--${note.id.slice(0, 8)}.md`;
        const targets = await resolveMentionTargets(
          prisma,
          note.content as Parameters<typeof resolveMentionTargets>[1],
        );
        const markdown = renderNoteMarkdown({
          note: {
            id: note.id,
            title: note.title,
            content: note.content as Parameters<
              typeof resolveMentionTargets
            >[1],
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
          },
          mentionTargets: targets,
          attachments: note.attachments.map((attachment) => ({
            originalName: attachment.originalName,
            mimeType: attachment.mimeType,
            byteSize: Number(attachment.byteSize),
            checksumSha256: attachment.checksumSha256,
          })),
        });
        await addBuffer(
          pack,
          `${directory}/${filename}`,
          Buffer.from(markdown),
        );

        for (const attachment of note.attachments) {
          const attachmentName = `${safeSegment(attachment.originalName, 140)}--${attachment.id.slice(0, 8)}`;
          const entry = pack.entry(
            header(
              `_attachments/${note.id}/${attachmentName}`,
              Number(attachment.byteSize),
            ),
          );
          await new Promise<void>(async (resolve, reject) => {
            entry.once("finish", resolve);
            entry.once("error", reject);
            try {
              const source = await openStoredFile(
                attachment.storageName,
                Number(attachment.byteSize),
              );
              source.once("error", reject);
              source.pipe(entry);
            } catch (error) {
              reject(error);
            }
          });
        }
      }
      pack.finalize();
    } catch (error) {
      pack.destroy(error instanceof Error ? error : new Error("Export failed"));
      output.destroy(
        error instanceof Error ? error : new Error("Export failed"),
      );
    }
  })();

  return {
    stream: output,
    filename: `linked-notes-markdown-${new Date().toISOString().slice(0, 10)}.tar.gz`,
    noteCount: notes.length,
  };
}

function noteDirectory(
  note: {
    folderId: string | null;
    archivedAt: Date | null;
    trashedAt: Date | null;
  },
  folders: Map<string, { id: string; name: string; parentId: string | null }>,
) {
  const segments = ["Linked Notes"];
  if (note.trashedAt) segments.push("_Trash");
  else if (note.archivedAt) segments.push("_Archive");
  if (note.folderId) {
    const folderSegments: string[] = [];
    let folder = folders.get(note.folderId);
    const seen = new Set<string>();
    while (folder && !seen.has(folder.id)) {
      seen.add(folder.id);
      folderSegments.unshift(safeSegment(folder.name, 100));
      folder = folder.parentId ? folders.get(folder.parentId) : undefined;
    }
    segments.push(...folderSegments);
  }
  return segments.join("/");
}

function safeSegment(value: string, maximum: number) {
  return (
    sanitizeDisplayFilename(value)
      .replaceAll("/", "-")
      .replaceAll("\\", "-")
      .replaceAll(/^\.+|\.+$/g, "")
      .slice(0, maximum) || "Untitled"
  );
}

function header(name: string, size: number): tar.Headers {
  return {
    name,
    size,
    mode: 0o600,
    mtime: ARCHIVE_EPOCH,
    type: "file",
  };
}

async function addBuffer(pack: tar.Pack, name: string, buffer: Buffer) {
  await new Promise<void>((resolve, reject) => {
    pack.entry(header(name, buffer.byteLength), buffer, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
