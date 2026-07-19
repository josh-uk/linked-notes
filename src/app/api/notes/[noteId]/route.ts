import { NextRequest, NextResponse } from "next/server";

import { getNote, updateNote } from "@/server/notes/note-service";
import { noteApiError } from "@/server/notes/api-response";

type NoteRouteContext = { params: Promise<{ noteId: string }> };

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: NoteRouteContext) {
  try {
    const { noteId } = await context.params;
    return NextResponse.json(await getNote(noteId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return noteApiError(error, "Linked Notes could not load the note");
  }
}

export async function PATCH(request: NextRequest, context: NoteRouteContext) {
  try {
    const { noteId } = await context.params;
    return NextResponse.json(await updateNote(noteId, await request.json()));
  } catch (error) {
    return noteApiError(error, "Linked Notes could not update the note");
  }
}
