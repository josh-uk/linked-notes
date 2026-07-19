import { NextResponse } from "next/server";

import { prisma } from "@/server/db";
import { ensureAttachmentDirectoryWritable } from "@/server/attachments/attachment-storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const [database, attachments] = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`,
    ensureAttachmentDirectoryWritable(),
  ]);
  if (database.status === "fulfilled" && attachments.status === "fulfilled") {
    return NextResponse.json(
      { status: "ok", database: "reachable", attachments: "writable" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    {
      status: "error",
      database: database.status === "fulfilled" ? "reachable" : "unreachable",
      attachments:
        attachments.status === "fulfilled" ? "writable" : "unavailable",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
