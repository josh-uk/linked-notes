import { Readable } from "node:stream";

import { contentDisposition } from "@/server/attachments/attachment-storage";
import { createWorkspaceMarkdownExport } from "@/server/exports/workspace-markdown";
import { noteApiError } from "@/server/notes/api-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const exported = await createWorkspaceMarkdownExport();
    return new Response(
      Readable.toWeb(exported.stream) as ReadableStream<
        Uint8Array<ArrayBuffer>
      >,
      {
        headers: {
          "Content-Type": "application/gzip",
          "Content-Disposition": contentDisposition(
            exported.filename,
            "attachment",
          ),
          "X-Content-Type-Options": "nosniff",
          "X-Linked-Notes-Count": exported.noteCount.toString(),
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    return noteApiError(error, "Linked Notes could not export the workspace");
  }
}
