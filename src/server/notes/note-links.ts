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
  const mentionIds = mentions.map(({ mentionId }) => mentionId);
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

  await transaction.noteLink.deleteMany({
    where: {
      sourceNoteId,
      ...(mentionIds.length > 0 ? { mentionId: { notIn: mentionIds } } : {}),
    },
  });

  for (const mention of mentions) {
    const targetNoteId = liveTargets.has(mention.targetId)
      ? mention.targetId
      : null;
    await transaction.noteLink.upsert({
      where: {
        sourceNoteId_mentionId: {
          sourceNoteId,
          mentionId: mention.mentionId,
        },
      },
      create: {
        sourceNoteId,
        targetNoteId,
        targetKey: mention.targetId,
        mentionId: mention.mentionId,
        context: mention.context,
      },
      update: {
        targetNoteId,
        targetKey: mention.targetId,
        context: mention.context,
      },
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

  return { items: [...groups.values()], totalMentions: links.length };
}

function compactExcerpt(value: string): string {
  const compact = value.replaceAll(/\s+/g, " ").trim();
  if (!compact) return "No additional text";
  return compact.length > 100 ? `${compact.slice(0, 97)}…` : compact;
}
