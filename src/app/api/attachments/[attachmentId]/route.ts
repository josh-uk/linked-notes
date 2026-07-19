import { Readable } from "node:stream";

import { NextRequest, NextResponse } from "next/server";

import {
  deleteAttachment,
  getAttachmentDownload,
} from "@/server/attachments/attachment-service";
import {
  contentDisposition,
  isSafePreviewMimeType,
} from "@/server/attachments/attachment-storage";
import { noteApiError } from "@/server/notes/api-response";

type AttachmentRouteContext = {
  params: Promise<{ attachmentId: string }>;
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: AttachmentRouteContext,
) {
  try {
    const { attachmentId } = await context.params;
    const { attachment, stream } = await getAttachmentDownload(attachmentId);
    const requestedInline =
      request.nextUrl.searchParams.get("disposition") === "inline";
    const inline =
      requestedInline && isSafePreviewMimeType(attachment.mimeType);
    return new Response(
      Readable.toWeb(stream) as ReadableStream<Uint8Array<ArrayBuffer>>,
      {
        headers: {
          "Content-Type": attachment.mimeType,
          "Content-Length": attachment.byteSize.toString(),
          "Content-Disposition": contentDisposition(
            attachment.originalName,
            inline ? "inline" : "attachment",
          ),
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
          ...(inline
            ? { "Content-Security-Policy": "default-src 'none'; sandbox" }
            : {}),
        },
      },
    );
  } catch (error) {
    return noteApiError(error, "Linked Notes could not read the attachment");
  }
}

export async function DELETE(
  request: NextRequest,
  context: AttachmentRouteContext,
) {
  try {
    const { attachmentId } = await context.params;
    return NextResponse.json(
      await deleteAttachment(attachmentId, await request.json()),
    );
  } catch (error) {
    return noteApiError(error, "Linked Notes could not remove the attachment");
  }
}
