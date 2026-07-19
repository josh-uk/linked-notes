import { NextRequest, NextResponse } from "next/server";

import { noteApiError } from "@/server/notes/api-response";
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
      const input = permanentDeleteInputSchema.parse({
        expectedVersion: (value as { expectedVersion?: unknown })
          .expectedVersion,
      });
      return NextResponse.json(await deleteNotePermanently(noteId, input));
    }
    const input = lifecycleInputSchema.parse(value);
    return NextResponse.json(await applyNoteLifecycle(noteId, input));
  } catch (error) {
    return noteApiError(error, "Linked Notes could not complete the action");
  }
}
