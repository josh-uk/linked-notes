import { Prisma } from "@prisma/client";
import { z } from "zod";

import type {
  AttachmentFilter,
  NoteSort,
  NoteSummary,
  NotesView,
  SearchPage,
  SortDirection,
} from "@/features/notes/types";
import { prisma } from "@/server/db";

import { applyConfiguredTrashRetention } from "./organization-service";

const commaSeparatedIds = z
  .string()
  .max(1_850)
  .transform((value) => value.split(",").filter(Boolean))
  .pipe(z.array(z.string().uuid()).max(30));

export const searchNotesInputSchema = z.object({
  q: z.string().trim().min(1).max(200),
  view: z.enum(["all", "pinned", "archive", "trash"]).default("all"),
  folderId: z.string().uuid().optional(),
  tagIds: commaSeparatedIds.optional(),
  attachments: z.enum(["any", "with", "without"]).default("any"),
  sort: z
    .enum(["relevance", "updated", "created", "title"])
    .default("relevance"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(40),
});

type SearchInput = {
  q: string;
  view: NotesView;
  folderId?: string;
  tagIds?: string[];
  attachments: AttachmentFilter;
  sort: NoteSort;
  direction: SortDirection;
  offset: number;
  limit: number;
};

type SearchRow = {
  id: string;
  title: string;
  contentText: string;
  optimisticVersion: number;
  folderId: string | null;
  folderName: string | null;
  pinnedAt: Date | null;
  archivedAt: Date | null;
  trashedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  attachmentCount: bigint;
  rank: number;
  titleHighlight: string;
  highlight: string;
};

export async function searchNotes(input: SearchInput): Promise<SearchPage> {
  await applyConfiguredTrashRetention();
  const conditions: Prisma.Sql[] = [
    Prisma.sql`(
      setweight(to_tsvector('simple', coalesce(n."title", '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(n."contentText", '')), 'B')
    ) @@ websearch_to_tsquery('simple', ${input.q})`,
  ];

  if (input.view === "trash") {
    conditions.push(Prisma.sql`n."trashedAt" IS NOT NULL`);
  } else {
    conditions.push(Prisma.sql`n."trashedAt" IS NULL`);
    if (input.view === "archive") {
      conditions.push(Prisma.sql`n."archivedAt" IS NOT NULL`);
    } else {
      conditions.push(Prisma.sql`n."archivedAt" IS NULL`);
    }
    if (input.view === "pinned") {
      conditions.push(Prisma.sql`n."pinnedAt" IS NOT NULL`);
    }
  }
  if (input.folderId) {
    conditions.push(Prisma.sql`n."folderId" = ${input.folderId}::uuid`);
  }
  if (input.tagIds?.length) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "NoteTag" nt
      WHERE nt."noteId" = n."id"
        AND nt."tagId" IN (${Prisma.join(input.tagIds.map((id) => Prisma.sql`${id}::uuid`))})
    )`);
  }
  if (input.attachments === "with") {
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "Attachment" a WHERE a."noteId" = n."id")`,
    );
  }
  if (input.attachments === "without") {
    conditions.push(
      Prisma.sql`NOT EXISTS (SELECT 1 FROM "Attachment" a WHERE a."noteId" = n."id")`,
    );
  }

  const direction =
    input.direction === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const order = searchOrder(input.sort, direction, input.q);
  const rows = await prisma.$queryRaw<SearchRow[]>(Prisma.sql`
    SELECT
      n."id",
      n."title",
      n."contentText",
      n."optimisticVersion",
      n."folderId",
      f."name" AS "folderName",
      n."pinnedAt",
      n."archivedAt",
      n."trashedAt",
      n."createdAt",
      n."updatedAt",
      (SELECT count(*) FROM "Attachment" a WHERE a."noteId" = n."id") AS "attachmentCount",
      ts_rank_cd(
        setweight(to_tsvector('simple', coalesce(n."title", '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(n."contentText", '')), 'B'),
        websearch_to_tsquery('simple', ${input.q})
      )::double precision AS "rank",
      ts_headline(
        'simple',
        n."title",
        websearch_to_tsquery('simple', ${input.q}),
        'StartSel=<mark>, StopSel=</mark>, MaxWords=20, MinWords=1, ShortWord=1, HighlightAll=true'
      ) AS "titleHighlight",
      ts_headline(
        'simple',
        coalesce(n."contentText", ''),
        websearch_to_tsquery('simple', ${input.q}),
        'StartSel=<mark>, StopSel=</mark>, MaxWords=28, MinWords=8, ShortWord=3, MaxFragments=2, FragmentDelimiter= … '
      ) AS "highlight"
    FROM "Note" n
    LEFT JOIN "Folder" f ON f."id" = n."folderId"
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY ${order}
    LIMIT ${input.limit + 1}
    OFFSET ${input.offset}
  `);

  const visible = rows.slice(0, input.limit);
  const tagsByNote = await getTagsByNote(visible.map(({ id }) => id));
  return {
    items: visible.map((row) =>
      serializeSearchRow(row, tagsByNote.get(row.id) ?? []),
    ),
    nextOffset: rows.length > input.limit ? input.offset + input.limit : null,
  };
}

function searchOrder(
  sort: NoteSort,
  direction: Prisma.Sql,
  query: string,
): Prisma.Sql {
  if (sort === "updated")
    return Prisma.sql`n."updatedAt" ${direction}, n."id" ${direction}`;
  if (sort === "created")
    return Prisma.sql`n."createdAt" ${direction}, n."id" ${direction}`;
  if (sort === "title")
    return Prisma.sql`lower(n."title") ${direction}, n."id" ${direction}`;
  return Prisma.sql`
    CASE
      WHEN to_tsvector('simple', coalesce(n."title", '')) @@ websearch_to_tsquery('simple', ${query})
        THEN 0
      ELSE 1
    END,
    "rank" DESC,
    n."updatedAt" DESC,
    n."id" ASC
  `;
}

async function getTagsByNote(noteIds: string[]) {
  const map = new Map<
    string,
    Array<{ id: string; displayName: string; color: string | null }>
  >();
  if (noteIds.length === 0) return map;
  const rows = await prisma.noteTag.findMany({
    where: { noteId: { in: noteIds } },
    orderBy: { tag: { normalizedName: "asc" } },
    include: { tag: true },
  });
  for (const row of rows) {
    const tags = map.get(row.noteId) ?? [];
    tags.push({
      id: row.tag.id,
      displayName: row.tag.displayName,
      color: row.tag.color,
    });
    map.set(row.noteId, tags);
  }
  return map;
}

function serializeSearchRow(
  row: SearchRow,
  tags: Array<{ id: string; displayName: string; color: string | null }>,
): NoteSummary {
  return {
    id: row.id,
    title: row.title || "Untitled Note",
    excerpt: compactExcerpt(row.contentText),
    titleHighlight: row.titleHighlight,
    highlight: row.highlight,
    rank: row.rank,
    optimisticVersion: row.optimisticVersion,
    folder:
      row.folderId && row.folderName
        ? { id: row.folderId, name: row.folderName }
        : null,
    tags,
    attachmentCount: Number(row.attachmentCount),
    pinnedAt: row.pinnedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    trashedAt: row.trashedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function compactExcerpt(value: string): string {
  const compact = value.replaceAll(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}…` : compact;
}
