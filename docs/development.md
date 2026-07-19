# Development

## Requirements

- Node.js 22 or newer and npm 11
- Docker Engine and Docker Compose v2
- Git and GitHub CLI for delivery work

Install with `npm ci`. Copy `.env.example` to `.env`, replace the password in both relevant variables, and start PostgreSQL with `docker compose up -d db`. PostgreSQL binds to loopback on `POSTGRES_PORT` for local development; choose another port when 5432 is already occupied.

## Quality gates

```bash
npm run format:check
npm run lint
npm run typecheck
npm run prisma:validate
npm run test
npm run test:integration
npm run test:performance # requires an isolated *_performance database
npm run test:upload-memory # requires the local Docker app
npm run build
npm run test:e2e
docker compose config
docker compose build
```

Tests must use deterministic fixtures and observable readiness conditions, not arbitrary sleeps. Integration tests receive a dedicated PostgreSQL database through `DATABASE_URL`. Browser tests use Playwright's managed Chromium installation.

The integration suite exercises the note service against real PostgreSQL. The
browser suite covers note creation and reload, autosave, pin/trash/restore,
optimistic conflicts, keyboard creation, mobile pane navigation, theming, and Axe
accessibility checks. It also covers keyboard and pointer mention selection,
loading/empty/error/self-link suggestions, rename-safe display, contextual
backlinks, lifecycle states, permanent-target deletion, broken references, and
link removal. To run browser tests against an already-running development server,
set `PLAYWRIGHT_EXTERNAL_SERVER=1` and `PLAYWRIGHT_BASE_URL`.

Phase 3 coverage adds real-PostgreSQL checks for folder depth and cycles,
destructive folder choices, normalized tags, bulk rollback, lifecycle/search
consistency, ranking/highlighting, GIN index presence, and trash retention. The
desktop Playwright journeys exercise folder/tag management, atomic note
placement, title/body search, archive/trash/permanent deletion, bulk
move/tag/archive, crowded-sidebar scrolling, and Axe.

Phase 4 coverage streams representative PDF, DOCX, JSON, PNG, JPEG, and unknown
binary fixtures through the attachment service and verifies byte-for-byte
downloads, safe derived MIME, SHA-256, dimensions, optimistic conflicts, limits,
interruption cleanup, missing/corrupt/orphan reconciliation, and byte removal
after attachment/note/retention transactions. Desktop Playwright covers picker,
drop, clipboard image, progress/retry, preview, download headers, filtering,
confirmation, storage checks, and Axe.

Always point destructive integration runs at a dedicated database, not the Docker
preview database:

```bash
DATABASE_URL=postgresql://linked_notes:your-password@127.0.0.1:5432/linked_notes_integration npm run test:integration
```

For example, when the default ports are already occupied:

```bash
POSTGRES_PORT=55432 docker compose up -d db
DATABASE_URL=postgresql://linked_notes:your-password@127.0.0.1:55432/linked_notes npm run prisma:migrate
DATABASE_URL=postgresql://linked_notes:your-password@127.0.0.1:55432/linked_notes npm run dev -- --port 3100
PLAYWRIGHT_EXTERNAL_SERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 npm run test:e2e
```

## Database changes

Edit `prisma/schema.prisma`, run `npm run prisma:migrate -- --name <short-name>` against a disposable development database, inspect the generated SQL, and commit both schema and migration. Production runs `prisma migrate deploy` in a one-shot Compose service; a failed migration prevents the app from starting.

Durable-link schema changes must preserve both identities: `targetKey` is the
immutable backlink key and `targetNoteId` is only the nullable live relation.
Migration tests should cover rename, lifecycle state, target deletion, multiple
mentions, and removal during a successful optimistic save.

## Search performance profile

`npm run test:performance` deliberately replaces data, so it refuses to run
unless `PERFORMANCE_DATABASE_URL` names a database ending in `_performance`.
Create and migrate an isolated database, then run:

```bash
PERFORMANCE_DATABASE_URL=postgresql://linked_notes:your-password@127.0.0.1:5432/linked_notes_performance npm run test:performance
```

The script seeds 10,000 notes plus representative folders, tags, links, and
attachments; warms and samples ranked full-text search and the main paginated
list; and prints timing statistics with `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`.
It is a repeatable regression profile, not a universal latency guarantee.

## Upload memory profile

With the Phase 4 image running in Compose, `npm run test:upload-memory` creates a
temporary note, streams a deterministic file in 64 KiB chunks, samples the app
container's memory via `docker stats`, verifies the server checksum, and removes
the attachment and note. It refuses non-loopback targets and caps its own test at
100 MiB.

```bash
APP_URL=http://127.0.0.1:3000 \
APP_CONTAINER=linked-notes-app-1 \
UPLOAD_BYTES=100663296 \
npm run test:upload-memory
```

## Dependency pins

Dependabot proposes npm, Actions, and Docker updates. GitHub Actions references use full commit SHAs with the readable release in a comment. Review upstream release notes and update the SHA and comment together.
