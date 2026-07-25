import { NextRequest, NextResponse } from "next/server";

import { aiApiError } from "@/server/ai/ai-errors";
import { semanticSearchNotes } from "@/server/ai/workspace-ai-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json(await semanticSearchNotes(await request.json()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return aiApiError(error, "Linked Notes could not search by meaning");
  }
}
