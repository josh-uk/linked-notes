import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { noteApiError } from "@/server/notes/api-response";
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
    return noteApiError(error, "Linked Notes could not search notes");
  }
}
