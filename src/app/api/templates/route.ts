import { NextRequest, NextResponse } from "next/server";

import { noteApiError } from "@/server/notes/api-response";
import {
  createNoteTemplate,
  listNoteTemplates,
} from "@/server/notes/productivity-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await listNoteTemplates(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return noteApiError(error, "Linked Notes could not load templates");
  }
}

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json(await createNoteTemplate(await request.json()), {
      status: 201,
    });
  } catch (error) {
    return noteApiError(error, "Linked Notes could not create the template");
  }
}
