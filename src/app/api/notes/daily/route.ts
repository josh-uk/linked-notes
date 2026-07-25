import { NextRequest, NextResponse } from "next/server";

import { noteApiError } from "@/server/notes/api-response";
import { getOrCreateDailyNote } from "@/server/notes/productivity-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const result = await getOrCreateDailyNote(await request.json());
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return noteApiError(error, "Linked Notes could not open the daily note");
  }
}
