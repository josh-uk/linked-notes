import { NextRequest, NextResponse } from "next/server";

import { noteApiError } from "@/server/notes/api-response";
import { setTrashRetention } from "@/server/notes/organization-service";

export async function PATCH(request: NextRequest) {
  try {
    return NextResponse.json(await setTrashRetention(await request.json()));
  } catch (error) {
    return noteApiError(error, "Linked Notes could not update trash retention");
  }
}
