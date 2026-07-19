import { NextRequest, NextResponse } from "next/server";

import { noteApiError } from "@/server/notes/api-response";
import {
  deleteFolder,
  updateFolder,
} from "@/server/notes/organization-service";

type FolderRouteContext = { params: Promise<{ folderId: string }> };

export async function PATCH(request: NextRequest, context: FolderRouteContext) {
  try {
    const { folderId } = await context.params;
    return NextResponse.json(
      await updateFolder(folderId, await request.json()),
    );
  } catch (error) {
    return noteApiError(error, "Linked Notes could not update the folder");
  }
}

export async function DELETE(
  request: NextRequest,
  context: FolderRouteContext,
) {
  try {
    const { folderId } = await context.params;
    return NextResponse.json(
      await deleteFolder(folderId, await request.json()),
    );
  } catch (error) {
    return noteApiError(error, "Linked Notes could not delete the folder");
  }
}
