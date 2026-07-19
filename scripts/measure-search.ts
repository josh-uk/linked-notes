import { performance } from "node:perf_hooks";

import { Prisma, PrismaClient } from "@prisma/client";

const databaseUrl = process.env.PERFORMANCE_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("PERFORMANCE_DATABASE_URL is required");
}

const databaseName = new URL(databaseUrl).pathname.slice(1);
if (!databaseName.endsWith("_performance")) {
  throw new Error(
    "Refusing to replace data unless the database name ends with _performance",
  );
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const noteCount = 10_000;
const sampleCount = 25;

async function main() {
  const seedStarted = performance.now();
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "Attachment", "NoteTag", "NoteLink", "Note", "Folder", "Tag", "Setting"
    CASCADE
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Folder" ("id", "name", "parentId", "sortOrder", "updatedAt")
    SELECT md5('folder-' || value)::uuid, 'Folder ' || value, NULL, value, now()
    FROM generate_series(1, 20) AS value
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Tag" ("id", "normalizedName", "displayName", "color", "updatedAt")
    SELECT
      md5('tag-' || value)::uuid,
      'tag ' || value,
      'Tag ' || value,
      '#4f46e5',
      now()
    FROM generate_series(1, 30) AS value
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Note" (
      "id", "title", "content", "contentText", "contentHtml", "contentSchema",
      "optimisticVersion", "folderId", "pinnedAt", "archivedAt", "trashedAt",
      "createdAt", "updatedAt"
    )
    SELECT
      md5('note-' || value)::uuid,
      CASE WHEN value % 100 = 0
        THEN 'Orchid title result ' || value
        ELSE 'Representative note ' || value
      END,
      jsonb_build_object(
        'type', 'doc',
        'content', jsonb_build_array(
          jsonb_build_object(
            'type', 'paragraph',
            'content', jsonb_build_array(
              jsonb_build_object('type', 'text', 'text', 'Representative content ' || value)
            )
          )
        )
      ),
      CASE WHEN value % 50 = 1
        THEN 'A body containing orchid research and representative prose for result ' || value
        ELSE 'Representative plain text body for note ' || value || ' with enough words for a useful excerpt.'
      END,
      '<p>Representative note</p>',
      1,
      1,
      md5('folder-' || ((value % 20) + 1))::uuid,
      CASE WHEN value % 17 = 0 THEN now() ELSE NULL END,
      CASE WHEN value % 23 = 0 THEN now() ELSE NULL END,
      CASE WHEN value % 41 = 0 THEN now() ELSE NULL END,
      now() - (value || ' minutes')::interval,
      now() - (value || ' minutes')::interval
    FROM generate_series(1, ${noteCount}) AS value
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "NoteTag" ("noteId", "tagId")
    SELECT
      md5('note-' || value)::uuid,
      md5('tag-' || ((value % 30) + 1))::uuid
    FROM generate_series(1, ${noteCount}) AS value
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "NoteLink" (
      "sourceNoteId", "targetNoteId", "targetKey", "mentionId", "context", "updatedAt"
    )
    SELECT
      md5('note-' || value)::uuid,
      md5('note-' || ((value % ${noteCount}) + 1))::uuid,
      md5('note-' || ((value % ${noteCount}) + 1))::uuid,
      md5('mention-' || value)::uuid,
      'Representative link context ' || value,
      now()
    FROM generate_series(1, ${noteCount}) AS value
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Attachment" (
      "id", "noteId", "originalName", "storageName", "mimeType", "byteSize", "checksumSha256"
    )
    SELECT
      md5('attachment-' || value)::uuid,
      md5('note-' || (value * 10))::uuid,
      'sample-' || value || '.bin',
      'sample-' || value,
      'application/octet-stream',
      1,
      md5('checksum-' || value) || md5('checksum-' || value)
    FROM generate_series(1, ${noteCount / 10}) AS value
  `);
  await prisma.$executeRawUnsafe('ANALYZE "Note"');
  const seedMs = performance.now() - seedStarted;

  const searchSamples: number[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const started = performance.now();
    await measuredSearch();
    searchSamples.push(performance.now() - started);
  }

  const listSamples: number[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const started = performance.now();
    await prisma.note.findMany({
      where: { trashedAt: null, archivedAt: null },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 40,
      select: { id: true, title: true, updatedAt: true },
    });
    listSamples.push(performance.now() - started);
  }

  const plan = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT n."id"
    FROM "Note" n
    WHERE n."trashedAt" IS NULL
      AND n."archivedAt" IS NULL
      AND (
        setweight(to_tsvector('simple', coalesce(n."title", '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(n."contentText", '')), 'B')
      ) @@ websearch_to_tsquery('simple', 'orchid')
    ORDER BY
      CASE WHEN to_tsvector('simple', coalesce(n."title", '')) @@ websearch_to_tsquery('simple', 'orchid')
        THEN 0 ELSE 1 END,
      ts_rank_cd(
        setweight(to_tsvector('simple', coalesce(n."title", '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(n."contentText", '')), 'B'),
        websearch_to_tsquery('simple', 'orchid')
      ) DESC,
      n."updatedAt" DESC
    LIMIT 40
  `);

  console.log(
    JSON.stringify(
      {
        databaseName,
        dataset: {
          notes: noteCount,
          folders: 20,
          tags: 30,
          noteTags: noteCount,
          links: noteCount,
          attachments: noteCount / 10,
        },
        seedMs: round(seedMs),
        searchMs: statistics(searchSamples),
        listMs: statistics(listSamples),
        explain: plan[0]?.["QUERY PLAN"],
      },
      null,
      2,
    ),
  );
}

async function measuredSearch() {
  return prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT n."id"
    FROM "Note" n
    WHERE n."trashedAt" IS NULL
      AND n."archivedAt" IS NULL
      AND (
        setweight(to_tsvector('simple', coalesce(n."title", '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(n."contentText", '')), 'B')
      ) @@ websearch_to_tsquery('simple', 'orchid')
    ORDER BY
      CASE WHEN to_tsvector('simple', coalesce(n."title", '')) @@ websearch_to_tsquery('simple', 'orchid')
        THEN 0 ELSE 1 END,
      ts_rank_cd(
        setweight(to_tsvector('simple', coalesce(n."title", '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(n."contentText", '')), 'B'),
        websearch_to_tsquery('simple', 'orchid')
      ) DESC,
      n."updatedAt" DESC
    LIMIT 40
  `);
}

function statistics(samples: number[]) {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    median: round(sorted[Math.floor(sorted.length / 2)]!),
    p95: round(sorted[Math.floor(sorted.length * 0.95)]!),
    max: round(sorted.at(-1)!),
  };
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
