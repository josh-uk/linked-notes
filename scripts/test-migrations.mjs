import { mkdtemp, cp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { PrismaClient } from "@prisma/client";

const adminUrl = new URL(
  process.env.MIGRATION_TEST_DATABASE_URL ??
    "postgresql://linked_notes:linked_notes@127.0.0.1:5432/postgres",
);
if (adminUrl.protocol !== "postgresql:" && adminUrl.protocol !== "postgres:") {
  throw new Error("MIGRATION_TEST_DATABASE_URL must be a PostgreSQL URL");
}
if (!new Set(["postgres", "template1"]).has(adminUrl.pathname.slice(1))) {
  throw new Error(
    "MIGRATION_TEST_DATABASE_URL must target the postgres or template1 maintenance database",
  );
}

const databases = {
  clean: "linked_notes_migration_clean",
  upgrade: "linked_notes_migration_upgrade",
};
const fixture = {
  source: "11111111-1111-4111-8111-111111111111",
  target: "22222222-2222-4222-8222-222222222222",
  mention: "33333333-3333-4333-8333-333333333333",
};

function databaseUrl(name) {
  const value = new URL(adminUrl);
  value.pathname = `/${name}`;
  return value.toString();
}

async function command(program, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      env: { ...process.env, ...environment },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${program} ${args.join(" ")} exited ${code}`)),
    );
  });
}

async function deploy(schema, url) {
  await command("npx", ["prisma", "migrate", "deploy", "--schema", schema], {
    DATABASE_URL: url,
  });
}

async function migrationCount(client) {
  const rows = await client.$queryRawUnsafe(
    'SELECT count(*)::int AS "count" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL',
  );
  return rows[0]?.count;
}

const admin = new PrismaClient({
  datasources: { db: { url: adminUrl.toString() } },
});
let temporaryDirectory;
try {
  for (const name of Object.values(databases)) {
    await admin.$queryRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
    );
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  }

  const cleanUrl = databaseUrl(databases.clean);
  await deploy("prisma/schema.prisma", cleanUrl);
  const clean = new PrismaClient({ datasources: { db: { url: cleanUrl } } });
  try {
    if ((await migrationCount(clean)) !== 4) {
      throw new Error("Clean migration did not apply all four migrations");
    }
    const metadata = await clean.schemaMetadata.findUnique({
      where: { id: 1 },
    });
    if (!metadata || metadata.dataSchemaVersion !== 1) {
      throw new Error("Clean migration did not create schema metadata");
    }
  } finally {
    await clean.$disconnect();
  }

  temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "linked-notes-upgrade-"),
  );
  const temporaryPrisma = path.join(temporaryDirectory, "prisma");
  await mkdir(path.join(temporaryPrisma, "migrations"), { recursive: true });
  await cp("prisma/schema.prisma", path.join(temporaryPrisma, "schema.prisma"));
  await cp(
    "prisma/migrations/migration_lock.toml",
    path.join(temporaryPrisma, "migrations", "migration_lock.toml"),
  );
  await cp(
    "prisma/migrations/20260719000000_initial",
    path.join(temporaryPrisma, "migrations", "20260719000000_initial"),
    { recursive: true },
  );

  const upgradeUrl = databaseUrl(databases.upgrade);
  await deploy(path.join(temporaryPrisma, "schema.prisma"), upgradeUrl);
  const upgrade = new PrismaClient({
    datasources: { db: { url: upgradeUrl } },
  });
  try {
    const document = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    await upgrade.$executeRawUnsafe(
      `INSERT INTO "Note" ("id", "title", "content", "contentText", "contentHtml", "updatedAt") VALUES ('${fixture.source}', 'Upgrade source', '${document}'::jsonb, '', '<p></p>', CURRENT_TIMESTAMP), ('${fixture.target}', 'Upgrade target', '${document}'::jsonb, '', '<p></p>', CURRENT_TIMESTAMP)`,
    );
    await upgrade.$executeRawUnsafe(
      `INSERT INTO "NoteLink" ("sourceNoteId", "targetNoteId", "mentionId", "context", "updatedAt") VALUES ('${fixture.source}', '${fixture.target}', '${fixture.mention}', '@Upgrade target', CURRENT_TIMESTAMP)`,
    );
  } finally {
    await upgrade.$disconnect();
  }

  await deploy("prisma/schema.prisma", upgradeUrl);
  const upgraded = new PrismaClient({
    datasources: { db: { url: upgradeUrl } },
  });
  try {
    if ((await migrationCount(upgraded)) !== 4) {
      throw new Error("Upgrade migration did not apply all four migrations");
    }
    const link = await upgraded.noteLink.findUnique({
      where: {
        sourceNoteId_mentionId: {
          sourceNoteId: fixture.source,
          mentionId: fixture.mention,
        },
      },
    });
    if (
      link?.targetKey !== fixture.target ||
      link.targetNoteId !== fixture.target
    ) {
      throw new Error("Upgrade did not preserve and backfill the durable link");
    }
    if ((await upgraded.note.count()) !== 2) {
      throw new Error("Upgrade did not preserve the pre-migration notes");
    }
  } finally {
    await upgraded.$disconnect();
  }

  console.log(
    "Migration proof passed: clean install plus earliest repository schema upgrade preserved notes and backfilled durable links",
  );
} finally {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  for (const name of Object.values(databases)) {
    await admin.$queryRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
    );
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`);
  }
  await admin.$disconnect();
}
