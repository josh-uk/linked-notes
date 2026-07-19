import { NextRequest, NextResponse } from "next/server";

import { noteApiError } from "@/server/notes/api-response";
import {
  searchNotes,
  searchNotesInputSchema,
} from "@/server/notes/search-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const input = searchNotesInputSchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    return NextResponse.json(await searchNotes(input), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return noteApiError(error, "Linked Notes could not search notes");
  }
}
