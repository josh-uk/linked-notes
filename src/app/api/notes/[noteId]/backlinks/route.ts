import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { listBacklinks } from "@/server/notes/note-links";

type NoteRouteContext = { params: Promise<{ noteId: string }> };

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: NoteRouteContext) {
  try {
    const { noteId } = await context.params;
    z.string().uuid().parse(noteId);
    return NextResponse.json(await listBacklinks(noteId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "The backlink request was invalid",
          },
        },
        { status: 400 },
      );
    }
    console.error("backlink_api_error", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Linked Notes could not load backlinks",
        },
      },
      { status: 500 },
    );
  }
}
