import { NextResponse } from "next/server";

import { aiApiError } from "@/server/ai/ai-errors";
import { suggestFoldersWithAi } from "@/server/ai/workspace-ai-service";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return NextResponse.json(await suggestFoldersWithAi(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return aiApiError(
      error,
      "Linked Notes could not suggest folders for unfiled notes",
    );
  }
}
