import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { noteApiError } from "@/server/notes/api-response";
import { listBacklinksPage } from "@/server/notes/note-links";

type NoteRouteContext = { params: Promise<{ noteId: string }> };

export const dynamic = "force-dynamic";

const querySchema = z.object({
  cursor: z.string().max(250).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(request: NextRequest, context: NoteRouteContext) {
  try {
    const { noteId } = await context.params;
    z.string().uuid().parse(noteId);
    const input = querySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    return NextResponse.json(await listBacklinksPage(noteId, input), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return noteApiError(error, "Linked Notes could not load backlinks");
  }
}
