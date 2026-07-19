import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { searchMentionSuggestions } from "@/server/notes/note-links";

const suggestionQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  currentNoteId: z.string().uuid().optional(),
});

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const query = suggestionQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    return NextResponse.json(
      {
        items: await searchMentionSuggestions(query.q, query.currentNoteId),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "The mention search was invalid",
          },
        },
        { status: 400 },
      );
    }
    console.error("mention_search_error", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Linked Notes could not search notes",
        },
      },
      { status: 500 },
    );
  }
}
