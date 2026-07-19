import { NextRequest, NextResponse } from "next/server";

import { noteApiError } from "@/server/notes/api-response";
import { applyBulkNoteAction } from "@/server/notes/note-service";

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json(await applyBulkNoteAction(await request.json()));
  } catch (error) {
    return noteApiError(error, "Linked Notes could not update the selection");
  }
}
