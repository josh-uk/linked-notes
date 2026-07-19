import { Readable } from "node:stream";

import { NextRequest, NextResponse } from "next/server";

import {
  restoreBackupInputSchema,
  restoreWorkspaceBackup,
} from "@/server/backups/backup-restore";
import { noteApiError } from "@/server/notes/api-response";
import { NoteDomainError } from "@/server/notes/note-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!request.body) {
      throw new NoteDomainError(
        "BACKUP_UPLOAD_EMPTY",
        "The restore request had no backup archive",
        400,
      );
    }
    const input = restoreBackupInputSchema.parse({
      mode: request.nextUrl.searchParams.get("mode"),
      confirmation:
        request.nextUrl.searchParams.get("confirmation") ?? undefined,
    });
    const contentLength = parseContentLength(
      request.headers.get("content-length"),
    );
    const source = Readable.fromWeb(
      request.body as Parameters<typeof Readable.fromWeb>[0],
    );
    const abort = () => source.destroy(new Error("Restore request aborted"));
    request.signal.addEventListener("abort", abort, { once: true });
    try {
      return NextResponse.json(
        await restoreWorkspaceBackup(source, input, { contentLength }),
      );
    } finally {
      request.signal.removeEventListener("abort", abort);
    }
  } catch (error) {
    return noteApiError(error, "Linked Notes could not restore the backup");
  }
}

function parseContentLength(value: string | null) {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) {
    throw new NoteDomainError(
      "BACKUP_LENGTH_INVALID",
      "The backup content length was invalid",
      400,
    );
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new NoteDomainError(
      "BACKUP_LENGTH_INVALID",
      "The backup content length was invalid",
      400,
    );
  }
  return length;
}
