import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { NoteDomainError } from "./note-errors";

export function noteApiError(error: unknown, fallback: string) {
  if (error instanceof NoteDomainError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, ...error.details } },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "The request was invalid" } },
      { status: 400 },
    );
  }
  console.error("notes_api_error", {
    error: error instanceof Error ? error.name : "unknown",
  });
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: fallback } },
    { status: 500 },
  );
}
