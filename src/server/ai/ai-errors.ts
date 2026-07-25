import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class AiDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AiDomainError";
  }
}

export function aiApiError(error: unknown, fallback: string) {
  if (error instanceof AiDomainError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "The request was invalid" } },
      { status: 400 },
    );
  }
  console.error("ai_api_error", {
    error: error instanceof Error ? error.name : "unknown",
  });
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: fallback } },
    { status: 500 },
  );
}
