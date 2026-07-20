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
npm run test:migrations # creates/drops only guarded *_migration_* databases
npm run test:release-audit # repository/version/docs/workflow drift
npm run test:security # exercises the PDF network-denial boundary
npm run test:performance # requires an isolated *_performance database
npm run test:upload-memory # requires the local Docker app
npm run build
npm run test:e2e
npm run test:release-image # requires locally tagged app/migration candidate images
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

The migration harness creates two explicitly named disposable databases through
`MIGRATION_TEST_DATABASE_URL`: one receives every migration from empty, while
the other receives only the earliest repository migration, real note/link rows,
then the remaining migrations. It proves data preservation and durable-link
backfill before dropping both databases. The maintenance database URL must end
in `/postgres` or `/template1`.

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

Phase 5 unit coverage validates Markdown semantics, canonical and relational
backup manifests, hostile archive paths, ID remapping, and self-contained escaped
print HTML. The real-PostgreSQL suite performs full replace round trips, safety
backup creation, merge collision remapping, link and byte preservation, and
no-mutation rejection for corrupt, checksum-invalid, traversal, oversized,
incomplete, entry-flood, and excessive-expansion archives. Desktop Playwright
downloads Markdown, generates the same PDF twice and compares SHA-256, downloads
a complete archive, performs a confirmed replace, downloads the safety backup,
and verifies the restored workspace.

Phase 6 coverage adds aggregate editor resource bounds, unsafe URL and stored-XSS
regressions, private-error/log redaction, direct PDF network denial, paginated
backlink integration, 10,000-note/list/link timings, and a 96 MiB upload-memory
profile. Production Playwright runs Axe in light and dark desktop themes, checks
responsive overflow and reduced motion, and drives real keyboard focus through
organization and destructive dialogs. See the [accessibility audit](accessibility.md),
[security audit](security-audit.md), and [performance measurements](performance.md).

Backup/restore integration and browser journeys replace the complete isolated
workspace and must run with one worker. Never point either at the preview or a
personal database. The browser server also needs a writable absolute
`ATTACHMENTS_DIR`; Docker provides Chromium at `/usr/bin/chromium`, while local
Playwright uses its managed Chromium installation.

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
attachments; warms and samples ranked full-text search, first/deep keyset note
pages, paginated backlinks, suggestions, and an extreme 1,000-mention save; and
prints timing statistics with `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. It is a
repeatable regression profile, not a universal latency guarantee.

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

## Release image proof

Build both Docker targets, then run the isolated internal-network journey:

```bash
docker build --target migrate -t linked-notes-migrate:release-candidate .
docker build --target runner -t linked-notes:release-candidate .
APP_IMAGE=linked-notes:release-candidate \
MIGRATE_IMAGE=linked-notes-migrate:release-candidate \
TARGET_PLATFORM=linux/amd64 \
npm run test:release-image
```

The script creates uniquely named disposable containers, volumes, and an
`--internal` network; migrates an empty database; verifies health, note and
attachment writes, PDF output, portable backup/replace restore, app replacement
persistence, and a denied outbound probe; then removes only those named
resources. GitHub repeats it for amd64 and arm64 before any image is published.
Each candidate runs on the matching native `ubuntu-24.04` hosted architecture
so Chromium, Prisma, and the complete runtime journey are proven without CPU
emulation.
On Docker Desktop a stuck first `docker start` client is killed and retried by
the harness without touching unrelated containers.

## Security scans

Pull requests and `master` run full-history Gitleaks, high-severity npm audit,
the pinned `eslint-plugin-security` JavaScript/TypeScript ruleset, and a Trivy
scan of the exact production runner target. GitHub Actions and scanner versions
are pinned; any enabled static-analysis warning and any high/critical image
finding with an available fix fails the workflow. Machine-readable ESLint and
Trivy JSON results are retained as artifacts. Three high-noise syntax heuristics
for dynamic filesystem paths, regular expressions, and indexed lookups are
explicitly disabled in the ESLint configuration; the equivalent trust
boundaries are covered by path-containment, archive-validation, search, and
identifier regression tests.

Equivalent local checks, using the versions pinned in
`.github/workflows/security.yml`, are:

```bash
gitleaks git --redact --verbose
npm audit --audit-level=high
npm run lint:security
docker build --target runner -t linked-notes:security-scan .
trivy image --scanners vuln --pkg-types os,library --ignore-unfixed --severity HIGH,CRITICAL --exit-code 1 linked-notes:security-scan
```

GitHub CodeQL is not supported for this private, personal-account repository
without GitHub Code Security. The self-contained ESLint security scan is the
strongest supported source-analysis equivalent here and does not depend on an
unavailable code-scanning API. If the repository later moves to a supported
organisation plan or becomes public, add CodeQL alongside this gate.

## Dependency pins

Dependabot proposes npm, Actions, and Docker updates. GitHub Actions references use full commit SHAs with the readable release in a comment. Review upstream release notes and update the SHA and comment together.
