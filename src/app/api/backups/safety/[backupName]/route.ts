import { Readable } from "node:stream";

import { contentDisposition } from "@/server/attachments/attachment-storage";
import { openSafetyBackup } from "@/server/backups/backup-archive";
import { noteApiError } from "@/server/notes/api-response";

type SafetyBackupRouteContext = {
  params: Promise<{ backupName: string }>;
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: SafetyBackupRouteContext,
) {
  try {
    const { backupName } = await context.params;
    const backup = await openSafetyBackup(backupName);
    return new Response(
      Readable.toWeb(backup.stream) as ReadableStream<Uint8Array<ArrayBuffer>>,
      {
        headers: {
          "Content-Type": "application/gzip",
          "Content-Length": backup.byteSize.toString(),
          "Content-Disposition": contentDisposition(backupName, "attachment"),
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    return noteApiError(error, "Linked Notes could not read the safety backup");
  }
}
