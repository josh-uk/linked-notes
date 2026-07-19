import { Readable } from "node:stream";

import { NextRequest, NextResponse } from "next/server";

import {
  listNoteAttachments,
  listAttachmentsInputSchema,
  uploadAttachment,
} from "@/server/attachments/attachment-service";
import { noteApiError } from "@/server/notes/api-response";
import { NoteDomainError } from "@/server/notes/note-errors";

type AttachmentRouteContext = { params: Promise<{ noteId: string }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: AttachmentRouteContext,
) {
  try {
    const { noteId } = await context.params;
    const input = listAttachmentsInputSchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    return NextResponse.json(await listNoteAttachments(noteId, input), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return noteApiError(error, "Linked Notes could not load the attachments");
  }
}

export async function POST(
  request: NextRequest,
  context: AttachmentRouteContext,
) {
  try {
    const { noteId } = await context.params;
    if (!request.body) {
      throw new NoteDomainError(
        "ATTACHMENT_EMPTY",
        "The attachment request had no body",
        400,
      );
    }
    const filename = parseFilename(
      request.headers.get("x-linked-notes-filename"),
    );
    const expectedVersion =
      request.nextUrl.searchParams.get("expectedVersion") ?? "";
    const contentLength = parseContentLength(
      request.headers.get("content-length"),
    );
    const source = Readable.fromWeb(
      request.body as Parameters<typeof Readable.fromWeb>[0],
    );
    const abort = () => source.destroy(new Error("Upload request aborted"));
    request.signal.addEventListener("abort", abort, { once: true });
    try {
      return NextResponse.json(
        await uploadAttachment(
          noteId,
          {
            filename,
            expectedVersion,
            contentLength,
            declaredMimeType: request.headers.get("content-type"),
          },
          source,
        ),
        { status: 201 },
      );
    } finally {
      request.signal.removeEventListener("abort", abort);
    }
  } catch (error) {
    return noteApiError(error, "Linked Notes could not store the attachment");
  }
}

function parseFilename(value: string | null) {
  if (!value) {
    throw new NoteDomainError(
      "ATTACHMENT_FILENAME_INVALID",
      "The attachment filename was missing",
      400,
    );
  }
  try {
    return decodeURIComponent(value);
  } catch {
    throw new NoteDomainError(
      "ATTACHMENT_FILENAME_INVALID",
      "The attachment filename was invalid",
      400,
    );
  }
}

function parseContentLength(value: string | null) {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) {
    throw new NoteDomainError(
      "ATTACHMENT_LENGTH_INVALID",
      "The attachment length was invalid",
      400,
    );
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new NoteDomainError(
      "ATTACHMENT_LENGTH_INVALID",
      "The attachment length was invalid",
      400,
    );
  }
  return length;
}
