import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

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
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = await request.json();
    return NextResponse.json(await createNote(input), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

function apiError(error: unknown) {
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
