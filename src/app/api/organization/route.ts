import { NextResponse } from "next/server";

import { noteApiError } from "@/server/notes/api-response";
import { getOrganization } from "@/server/notes/organization-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getOrganization(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return noteApiError(error, "Linked Notes could not load organization data");
  }
}
