import { NextRequest, NextResponse } from "next/server";

import { reconcileAttachments } from "@/server/attachments/attachment-service";
import { noteApiError } from "@/server/notes/api-response";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json(await reconcileAttachments(await request.json()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return noteApiError(
      error,
      "Linked Notes could not reconcile attachment storage",
    );
  }
}
