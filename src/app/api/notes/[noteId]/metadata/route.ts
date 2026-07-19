import { NextRequest, NextResponse } from "next/server";

import { noteApiError } from "@/server/notes/api-response";
import { updateNoteOrganization } from "@/server/notes/note-service";

type NoteRouteContext = { params: Promise<{ noteId: string }> };

export async function PATCH(request: NextRequest, context: NoteRouteContext) {
  try {
    const { noteId } = await context.params;
    return NextResponse.json(
      await updateNoteOrganization(noteId, await request.json()),
    );
  } catch (error) {
    return noteApiError(error, "Linked Notes could not organize the note");
  }
}
