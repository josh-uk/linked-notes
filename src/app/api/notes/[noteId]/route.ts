import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { getNote, updateNote } from "@/server/notes/note-service";
import { NoteDomainError } from "@/server/notes/note-errors";

type NoteRouteContext = { params: Promise<{ noteId: string }> };

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: NoteRouteContext) {
  try {
    const { noteId } = await context.params;
    return NextResponse.json(await getNote(noteId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest, context: NoteRouteContext) {
  try {
    const { noteId } = await context.params;
    return NextResponse.json(await updateNote(noteId, await request.json()));
  } catch (error) {
    return apiError(error);
  }
}

function apiError(error: unknown) {
  if (error instanceof NoteDomainError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, ...error.details } },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "The note request was invalid",
        },
      },
      { status: 400 },
    );
  }
  console.error("note_api_error", {
    error: error instanceof Error ? error.name : "unknown",
  });
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Linked Notes could not complete the request",
      },
    },
    { status: 500 },
  );
}
