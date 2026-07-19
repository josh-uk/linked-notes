import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import {
  generateWorkspaceBackup,
  openGeneratedBackup,
  removeGeneratedBackup,
} from "@/server/backups/backup-archive";
import { contentDisposition } from "@/server/attachments/attachment-storage";
import { noteApiError } from "@/server/notes/api-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  let backup: Awaited<ReturnType<typeof generateWorkspaceBackup>> | null = null;
  try {
    backup = await generateWorkspaceBackup();
    const stream = openGeneratedBackup(backup);
    const cleanup = () => {
      if (backup) void removeGeneratedBackup(backup);
    };
    stream.once("close", cleanup);
    stream.once("error", cleanup);
    return new Response(
      Readable.toWeb(stream) as ReadableStream<Uint8Array<ArrayBuffer>>,
      {
        headers: {
          "Content-Type": "application/gzip",
          "Content-Length": backup.byteSize.toString(),
          "Content-Disposition": contentDisposition(
            backup.filename,
            "attachment",
          ),
          "X-Content-Type-Options": "nosniff",
          "X-Linked-Notes-Archive-Sha256": backup.checksumSha256,
          "X-Linked-Notes-Manifest-Sha256": backup.manifestChecksumSha256,
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    if (backup) await removeGeneratedBackup(backup);
    return noteApiError(error, "Linked Notes could not create the backup");
  }
}

export async function HEAD() {
  return NextResponse.json(
    {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Use GET to create a backup",
      },
    },
    { status: 405 },
  );
}
