import { NextRequest, NextResponse } from "next/server";

import { noteApiError } from "@/server/notes/api-response";
import {
  createNote,
  listNotes,
  listNotesInputSchema,
} from "@/server/notes/note-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const query = listNotesInputSchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    return NextResponse.json(await listNotes(query), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return noteApiError(error, "Linked Notes could not load the notes");
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = await request.json();
    return NextResponse.json(await createNote(input), { status: 201 });
  } catch (error) {
    return noteApiError(error, "Linked Notes could not create the note");
  }
}
