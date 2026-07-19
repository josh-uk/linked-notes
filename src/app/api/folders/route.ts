import { NextRequest, NextResponse } from "next/server";

import { noteApiError } from "@/server/notes/api-response";
import { createFolder } from "@/server/notes/organization-service";

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json(await createFolder(await request.json()), {
      status: 201,
    });
  } catch (error) {
    return noteApiError(error, "Linked Notes could not create the folder");
  }
}
