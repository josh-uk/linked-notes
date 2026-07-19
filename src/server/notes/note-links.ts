import { Prisma } from "@prisma/client";

import { extractMentions } from "@/features/notes/mention-document";
import type {
  BacklinkGroup,
  BacklinksResponse,
  EditorDocument,
  MentionSuggestion,
  MentionTarget,
} from "@/features/notes/types";
import { prisma } from "@/server/db";

import { NoteDomainError } from "./note-errors";

type LinkDatabase = Pick<Prisma.TransactionClient, "note" | "noteLink">;

export async function searchMentionSuggestions(
  query: string,
  currentNoteId?: string,
): Promise<MentionSuggestion[]> {
  const normalized = query.trim().toLocaleLowerCase();
  const candidates = await prisma.$queryRaw<
    Array<{
      id: string;
      title: string;
      contentText: string;
      updatedAt: Date;
    }>
  >(Prisma.sql`
    SELECT "id", "title", "contentText", "updatedAt"
    FROM "Note"
    WHERE "trashedAt" IS NULL
      AND "archivedAt" IS NULL
      AND (${normalized}::text = '' OR strpos(lower("title"), ${normalized}::text) > 0)
    ORDER BY
      CASE
        WHEN ${normalized}::text = '' OR left(lower("title"), char_length(${normalized}::text)) = ${normalized}::text
          THEN 0
        ELSE 1
      END,
      "updatedAt" DESC,
      "id" ASC
    LIMIT 10
  `);

  return candidates.map((note) => ({
    kind: "note" as const,
    id: note.id,
    label: note.title || "Untitled Note",
    excerpt: compactExcerpt(note.contentText),
    updatedAt: note.updatedAt.toISOString(),
    isSelf: note.id === currentNoteId,
  }));
}

export async function reconcileNoteLinks(
  transaction: Prisma.TransactionClient,
  sourceNoteId: string,
  document: EditorDocument,
) {
  const mentions = extractMentions(document);
  const liveTargets = new Set(
    (
      await transaction.note.findMany({
        where: {
          id: { in: [...new Set(mentions.map(({ targetId }) => targetId))] },
        },
        select: { id: true },
      })
    ).map(({ id }) => id),
  );

  await transaction.noteLink.deleteMany({ where: { sourceNoteId } });
  if (mentions.length > 0) {
    await transaction.noteLink.createMany({
      data: mentions.map((mention) => ({
        sourceNoteId,
        targetNoteId: liveTargets.has(mention.targetId)
          ? mention.targetId
          : null,
        targetKey: mention.targetId,
        mentionId: mention.mentionId,
        context: mention.context,
      })),
    });
  }
}

export async function resolveMentionTargets(
  database: LinkDatabase,
  document: EditorDocument,
): Promise<MentionTarget[]> {
  const targetIds = [
    ...new Set(extractMentions(document).map(({ targetId }) => targetId)),
  ];
  if (targetIds.length === 0) return [];

  const targets = await database.note.findMany({
    where: { id: { in: targetIds } },
    select: {
      id: true,
      title: true,
      archivedAt: true,
      trashedAt: true,
    },
  });
  const byId = new Map(targets.map((target) => [target.id, target]));

  return targetIds.map((id) => {
    const target = byId.get(id);
    if (!target) return { id, title: null, state: "missing" as const };
    return {
      id,
      title: target.title || "Untitled Note",
      state: target.trashedAt
        ? ("trashed" as const)
        : target.archivedAt
          ? ("archived" as const)
          : ("active" as const),
    };
  });
}

export async function listBacklinks(
  targetId: string,
): Promise<BacklinksResponse> {
  const links = await prisma.noteLink.findMany({
    where: { targetKey: targetId },
    orderBy: [{ sourceNote: { updatedAt: "desc" } }, { mentionId: "asc" }],
    include: {
      sourceNote: {
        select: {
          id: true,
          title: true,
          archivedAt: true,
          trashedAt: true,
          updatedAt: true,
        },
      },
    },
  });

  const groups = new Map<string, BacklinkGroup>();
  for (const link of links) {
    const source = link.sourceNote;
    const existing = groups.get(source.id);
    const context = {
      mentionId: link.mentionId,
      context: link.context || `@${source.title || "Untitled Note"}`,
    };
    if (existing) {
      existing.contexts.push(context);
      continue;
    }
    groups.set(source.id, {
      sourceNoteId: source.id,
      sourceTitle: source.title || "Untitled Note",
      sourceState: source.trashedAt
        ? "trashed"
        : source.archivedAt
          ? "archived"
          : "active",
      sourceUpdatedAt: source.updatedAt.toISOString(),
      contexts: [context],
    });
  }

  return {
    items: [...groups.values()],
    totalMentions: links.length,
    nextCursor: null,
  };
}

export async function listBacklinksPage(
  targetId: string,
  input: { cursor?: string; limit: number },
): Promise<BacklinksResponse> {
  const cursor = input.cursor ? decodeBacklinkCursor(input.cursor) : null;
  const [links, totalMentions] = await Promise.all([
    prisma.noteLink.findMany({
      where: { targetKey: targetId },
      orderBy: [
        { updatedAt: "desc" },
        { sourceNoteId: "asc" },
        { mentionId: "asc" },
      ],
      take: input.limit + 1,
      ...(cursor
        ? {
            cursor: {
              sourceNoteId_mentionId: {
                sourceNoteId: cursor.sourceNoteId,
                mentionId: cursor.mentionId,
              },
            },
            skip: 1,
          }
        : {}),
      include: {
        sourceNote: {
          select: {
            id: true,
            title: true,
            archivedAt: true,
            trashedAt: true,
            updatedAt: true,
          },
        },
      },
    }),
    prisma.noteLink.count({ where: { targetKey: targetId } }),
  ]);
  const hasMore = links.length > input.limit;
  const visible = hasMore ? links.slice(0, input.limit) : links;
  return {
    items: groupBacklinks(visible),
    totalMentions,
    nextCursor: hasMore
      ? encodeBacklinkCursor(
          visible.at(-1)!.sourceNoteId,
          visible.at(-1)!.mentionId,
        )
      : null,
  };
}

function groupBacklinks(
  links: Array<{
    mentionId: string;
    context: string | null;
    sourceNote: {
      id: string;
      title: string;
      archivedAt: Date | null;
      trashedAt: Date | null;
      updatedAt: Date;
    };
  }>,
) {
  const groups = new Map<string, BacklinkGroup>();
  for (const link of links) {
    const source = link.sourceNote;
    const existing = groups.get(source.id);
    const context = {
      mentionId: link.mentionId,
      context: link.context || `@${source.title || "Untitled Note"}`,
    };
    if (existing) {
      existing.contexts.push(context);
      continue;
    }
    groups.set(source.id, {
      sourceNoteId: source.id,
      sourceTitle: source.title || "Untitled Note",
      sourceState: source.trashedAt
        ? "trashed"
        : source.archivedAt
          ? "archived"
          : "active",
      sourceUpdatedAt: source.updatedAt.toISOString(),
      contexts: [context],
    });
  }
  return [...groups.values()];
}

function encodeBacklinkCursor(sourceNoteId: string, mentionId: string) {
  return Buffer.from(JSON.stringify({ sourceNoteId, mentionId })).toString(
    "base64url",
  );
}

function decodeBacklinkCursor(value: string) {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString()) as {
      sourceNoteId?: unknown;
      mentionId?: unknown;
    };
    const id = (input: unknown) =>
      typeof input === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input,
      )
        ? input
        : null;
    const sourceNoteId = id(parsed.sourceNoteId);
    const mentionId = id(parsed.mentionId);
    if (!sourceNoteId || !mentionId) throw new Error("invalid");
    return { sourceNoteId, mentionId };
  } catch {
    throw new NoteDomainError(
      "BACKLINK_CURSOR_INVALID",
      "The backlink cursor was invalid",
      400,
    );
  }
}

function compactExcerpt(value: string): string {
  const compact = value.replaceAll(/\s+/g, " ").trim();
  if (!compact) return "No additional text";
  return compact.length > 100 ? `${compact.slice(0, 97)}…` : compact;
}
