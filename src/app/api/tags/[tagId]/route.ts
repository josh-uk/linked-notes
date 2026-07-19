import { NextRequest, NextResponse } from "next/server";

import { noteApiError } from "@/server/notes/api-response";
import { deleteTag, updateTag } from "@/server/notes/organization-service";

type TagRouteContext = { params: Promise<{ tagId: string }> };

export async function PATCH(request: NextRequest, context: TagRouteContext) {
  try {
    const { tagId } = await context.params;
    return NextResponse.json(await updateTag(tagId, await request.json()));
  } catch (error) {
    return noteApiError(error, "Linked Notes could not update the tag");
  }
}

export async function DELETE(_request: NextRequest, context: TagRouteContext) {
  try {
    const { tagId } = await context.params;
    return NextResponse.json(await deleteTag(tagId));
  } catch (error) {
    return noteApiError(error, "Linked Notes could not delete the tag");
  }
}
