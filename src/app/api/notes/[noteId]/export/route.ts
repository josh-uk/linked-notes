import { NextRequest } from "next/server";

import {
  exportNote,
  noteExportInputSchema,
} from "@/server/exports/note-export-service";
import { contentDisposition } from "@/server/attachments/attachment-storage";
import { noteApiError } from "@/server/notes/api-response";

type NoteExportRouteContext = { params: Promise<{ noteId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: NoteExportRouteContext,
) {
  try {
    const { noteId } = await context.params;
    const input = noteExportInputSchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    const exported = await exportNote(noteId, input);
    return new Response(new Uint8Array(exported.body), {
      headers: {
        "Content-Type": exported.mimeType,
        "Content-Length": exported.body.byteLength.toString(),
        "Content-Disposition": contentDisposition(
          exported.filename,
          "attachment",
        ),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return noteApiError(error, "Linked Notes could not export the note");
  }
}
