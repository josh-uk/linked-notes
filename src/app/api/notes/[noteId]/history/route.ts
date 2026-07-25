import { NextRequest, NextResponse } from "next/server";

import { noteApiError } from "@/server/notes/api-response";
import {
  listNoteHistory,
  listNoteHistoryInputSchema,
  restoreNoteRevision,
} from "@/server/notes/note-service";

type HistoryRouteContext = { params: Promise<{ noteId: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: HistoryRouteContext) {
  try {
    const { noteId } = await context.params;
    const query = listNoteHistoryInputSchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    return NextResponse.json(await listNoteHistory(noteId, query), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return noteApiError(error, "Linked Notes could not load note history");
  }
}

export async function POST(request: NextRequest, context: HistoryRouteContext) {
  try {
    const { noteId } = await context.params;
    return NextResponse.json(
      await restoreNoteRevision(noteId, await request.json()),
    );
  } catch (error) {
    return noteApiError(error, "Linked Notes could not restore that version");
  }
}
