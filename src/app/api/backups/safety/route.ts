import { NextResponse } from "next/server";

import { listSafetyBackups } from "@/server/backups/backup-archive";
import { noteApiError } from "@/server/notes/api-response";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(
      { items: await listSafetyBackups() },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return noteApiError(error, "Linked Notes could not list safety backups");
  }
}
