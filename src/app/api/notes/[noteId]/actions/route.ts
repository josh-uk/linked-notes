import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { NoteDomainError } from "@/server/notes/note-errors";
import {
  applyNoteLifecycle,
  deleteNotePermanently,
  lifecycleInputSchema,
  permanentDeleteInputSchema,
} from "@/server/notes/note-service";

type NoteRouteContext = { params: Promise<{ noteId: string }> };

export async function POST(request: NextRequest, context: NoteRouteContext) {
  try {
    const { noteId } = await context.params;
    const value = (await request.json()) as { action?: unknown };
    if (value.action === "delete") {
      const input = permanentDeleteInputSchema.parse(value);
      return NextResponse.json(await deleteNotePermanently(noteId, input));
    }
    const input = lifecycleInputSchema.parse(value);
    return NextResponse.json(await applyNoteLifecycle(noteId, input));
  } catch (error) {
    if (error instanceof NoteDomainError) {
      return NextResponse.json(
        {
          error: { code: error.code, message: error.message, ...error.details },
        },
        { status: error.status },
      );
    }
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "The note action was invalid",
          },
        },
        { status: 400 },
      );
    }
    console.error("note_action_error", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Linked Notes could not complete the action",
        },
      },
      { status: 500 },
    );
  }
}
