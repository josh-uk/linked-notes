import { NextRequest, NextResponse } from "next/server";

import { importMarkdownFiles } from "@/server/imports/markdown-import-service";
import { noteApiError } from "@/server/notes/api-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json(await importMarkdownFiles(await request.json()));
  } catch (error) {
    return noteApiError(
      error,
      "Linked Notes could not import the Markdown files",
    );
  }
}
