import { NextRequest, NextResponse } from "next/server";

import { aiApiError } from "@/server/ai/ai-errors";
import { analyzeNoteWithAi } from "@/server/ai/note-ai-service";

type NoteAiRouteContext = { params: Promise<{ noteId: string }> };

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: NoteAiRouteContext) {
  try {
    const { noteId } = await context.params;
    return NextResponse.json(
      await analyzeNoteWithAi(noteId, await request.json()),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return aiApiError(error, "Linked Notes could not run local AI");
  }
}
