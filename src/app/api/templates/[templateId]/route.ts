import { NextRequest, NextResponse } from "next/server";

import { noteApiError } from "@/server/notes/api-response";
import {
  deleteNoteTemplate,
  updateNoteTemplate,
} from "@/server/notes/productivity-service";

type TemplateRouteContext = { params: Promise<{ templateId: string }> };

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: TemplateRouteContext,
) {
  try {
    const { templateId } = await context.params;
    return NextResponse.json(
      await updateNoteTemplate(templateId, await request.json()),
    );
  } catch (error) {
    return noteApiError(error, "Linked Notes could not update the template");
  }
}

export async function DELETE(
  _request: NextRequest,
  context: TemplateRouteContext,
) {
  try {
    const { templateId } = await context.params;
    return NextResponse.json(await deleteNoteTemplate(templateId));
  } catch (error) {
    return noteApiError(error, "Linked Notes could not delete the template");
  }
}
