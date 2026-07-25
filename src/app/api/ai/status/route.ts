import { NextResponse } from "next/server";

import { aiApiError } from "@/server/ai/ai-errors";
import { getAiStatus } from "@/server/ai/note-ai-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getAiStatus(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return aiApiError(error, "Linked Notes could not check local AI");
  }
}
