import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

import { Prisma, PrismaClient } from "@prisma/client";

import type { EditorDocument } from "@/features/notes/types";
import { deriveEditorDocument } from "@/server/notes/derive-document";

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
const editorSampleCount = 8;

async function main() {
  const seedStarted = performance.now();
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION linked_notes_benchmark_uuid(value text)
    RETURNS uuid
    LANGUAGE SQL
    IMMUTABLE
    STRICT
    PARALLEL SAFE
    AS $function$
      SELECT (
        substr(md5(value), 1, 12) || '4' || substr(md5(value), 14, 3) ||
        '8' || substr(md5(value), 18, 15)
      )::uuid
    $function$
  `);
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "Attachment", "NoteTag", "NoteLink", "Note", "Folder", "Tag", "Setting"
    CASCADE
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Folder" ("id", "name", "parentId", "sortOrder", "updatedAt")
    SELECT linked_notes_benchmark_uuid('folder-' || value), 'Folder ' || value, NULL, value, now()
    FROM generate_series(1, 20) AS value
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Tag" ("id", "normalizedName", "displayName", "color", "updatedAt")
    SELECT
      linked_notes_benchmark_uuid('tag-' || value),
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
      linked_notes_benchmark_uuid('note-' || value),
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
      linked_notes_benchmark_uuid('folder-' || ((value % 20) + 1)),
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
      linked_notes_benchmark_uuid('note-' || value),
      linked_notes_benchmark_uuid('tag-' || ((value % 30) + 1))
    FROM generate_series(1, ${noteCount}) AS value
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "NoteLink" (
      "sourceNoteId", "targetNoteId", "targetKey", "mentionId", "context", "updatedAt"
    )
    SELECT
      linked_notes_benchmark_uuid('note-' || value),
      linked_notes_benchmark_uuid('note-' || (CASE WHEN value <= 1000 THEN 1 ELSE ((value % ${noteCount}) + 1) END)),
      linked_notes_benchmark_uuid('note-' || (CASE WHEN value <= 1000 THEN 1 ELSE ((value % ${noteCount}) + 1) END)),
      linked_notes_benchmark_uuid('mention-' || value),
      'Representative link context ' || value,
      now()
    FROM generate_series(1, ${noteCount}) AS value
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Attachment" (
      "id", "noteId", "originalName", "storageName", "mimeType", "byteSize", "checksumSha256"
    )
    SELECT
      linked_notes_benchmark_uuid('attachment-' || value),
      linked_notes_benchmark_uuid('note-' || (value * 10)),
      'sample-' || value || '.bin',
      'sample-' || value,
      'application/octet-stream',
      1,
      md5('checksum-' || value) || md5('checksum-' || value)
    FROM generate_series(1, ${noteCount / 10}) AS value
  `);
  await prisma.$executeRawUnsafe('ANALYZE "Note"');
  await prisma.$executeRawUnsafe('ANALYZE "NoteLink"');
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

  const deepCursor = await prisma.note.findFirstOrThrow({
    where: { trashedAt: null, archivedAt: null },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    skip: 4_999,
    select: { id: true },
  });
  const deepListSamples: number[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const started = performance.now();
    await prisma.note.findMany({
      where: { trashedAt: null, archivedAt: null },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      cursor: { id: deepCursor.id },
      skip: 1,
      take: 40,
      select: { id: true, title: true, updatedAt: true },
    });
    deepListSamples.push(performance.now() - started);
  }

  const backlinkTarget = await prisma.note.findFirstOrThrow({
    where: { title: "Representative note 1" },
    select: { id: true },
  });
  const backlinkSamples: number[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const started = performance.now();
    await prisma.noteLink.findMany({
      where: { targetKey: backlinkTarget.id },
      orderBy: [
        { updatedAt: "desc" },
        { sourceNoteId: "asc" },
        { mentionId: "asc" },
      ],
      take: 51,
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
    backlinkSamples.push(performance.now() - started);
  }

  const suggestionSamples: number[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const started = performance.now();
    await measuredSuggestions();
    suggestionSamples.push(performance.now() - started);
  }

  const editorTargets = await prisma.note.findMany({
    orderBy: { id: "asc" },
    take: 1_000,
    select: { id: true },
  });
  const editorSource = await prisma.note.findFirstOrThrow({
    where: { title: "Orchid title result 2000" },
    select: { id: true },
  });
  const editorDocument: EditorDocument = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: editorTargets.map((target, index) => ({
          type: "mention",
          attrs: {
            id: target.id,
            mentionId: randomUUID(),
            label: `Representative target ${index}`,
          },
        })),
      },
    ],
  };
  const editorDeriveSamples: number[] = [];
  const linkReconcileSamples: number[] = [];
  for (let sample = 0; sample < editorSampleCount; sample += 1) {
    const deriveStarted = performance.now();
    const derived = deriveEditorDocument(editorDocument);
    editorDeriveSamples.push(performance.now() - deriveStarted);
    const reconcileStarted = performance.now();
    await prisma.$transaction(async (transaction) => {
      await transaction.noteLink.deleteMany({
        where: { sourceNoteId: editorSource.id },
      });
      await transaction.noteLink.createMany({
        data: editorTargets.map((target, index) => ({
          sourceNoteId: editorSource.id,
          targetNoteId: target.id,
          targetKey: target.id,
          mentionId: String(
            editorDocument.content![0]!.content![index]!.attrs!.mentionId,
          ),
          context: `Representative target ${index}`,
        })),
      });
      await transaction.note.update({
        where: { id: editorSource.id },
        data: {
          content: derived.content as Prisma.InputJsonValue,
          contentText: derived.plainText,
          contentHtml: derived.sanitizedHtml,
          optimisticVersion: { increment: 1 },
        },
      });
    });
    linkReconcileSamples.push(performance.now() - reconcileStarted);
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
  const listPlan = await prisma.$queryRawUnsafe<
    Array<Record<string, unknown>>
  >(`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT "id", "title", "updatedAt"
    FROM "Note"
    WHERE "trashedAt" IS NULL AND "archivedAt" IS NULL
    ORDER BY "updatedAt" DESC, "id" DESC
    LIMIT 40
  `);
  const backlinkPlan = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT "sourceNoteId", "mentionId", "context"
    FROM "NoteLink"
    WHERE "targetKey" = ${backlinkTarget.id}::uuid
    ORDER BY "updatedAt" DESC, "sourceNoteId" ASC, "mentionId" ASC
    LIMIT 51
  `,
  );

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
        deepCursorListMs: statistics(deepListSamples),
        backlinkPageMs: statistics(backlinkSamples),
        suggestionMs: statistics(suggestionSamples),
        editorDerive1000MentionsMs: statistics(editorDeriveSamples),
        linkReconcile1000MentionsMs: statistics(linkReconcileSamples),
        explain: {
          search: plan[0]?.["QUERY PLAN"],
          list: listPlan[0]?.["QUERY PLAN"],
          backlinks: backlinkPlan[0]?.["QUERY PLAN"],
        },
      },
      null,
      2,
    ),
  );
}

async function measuredSuggestions() {
  return prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "Note"
    WHERE "trashedAt" IS NULL
      AND "archivedAt" IS NULL
      AND strpos(lower("title"), 'representative') > 0
    ORDER BY
      CASE WHEN left(lower("title"), char_length('representative')) = 'representative'
        THEN 0 ELSE 1 END,
      "updatedAt" DESC,
      "id" ASC
    LIMIT 10
  `);
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
  .finally(async () => {
    await prisma
      .$executeRawUnsafe(
        "DROP FUNCTION IF EXISTS linked_notes_benchmark_uuid(text)",
      )
      .catch(() => undefined);
    await prisma.$disconnect();
  });
