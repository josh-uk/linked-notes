import { NextResponse } from "next/server";

import { scanWorkspaceCleanupWithAi } from "@/server/ai/cleanup-ai-service";
import { aiApiError } from "@/server/ai/ai-errors";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return NextResponse.json(await scanWorkspaceCleanupWithAi(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return aiApiError(error, "Linked Notes could not scan the workspace");
  }
}
