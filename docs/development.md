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
npm run build
npm run test:e2e
docker compose config
docker compose build
```

Tests must use deterministic fixtures and observable readiness conditions, not arbitrary sleeps. Integration tests receive a dedicated PostgreSQL database through `DATABASE_URL`. Browser tests use Playwright's managed Chromium installation.

The integration suite exercises the note service against real PostgreSQL. The
browser suite covers note creation and reload, autosave, pin/trash/restore,
optimistic conflicts, keyboard creation, mobile pane navigation, theming, and Axe
accessibility checks. To run browser tests against an already-running development
server, set `PLAYWRIGHT_EXTERNAL_SERVER=1` and `PLAYWRIGHT_BASE_URL`.

For example, when the default ports are already occupied:

```bash
POSTGRES_PORT=55432 docker compose up -d db
DATABASE_URL=postgresql://linked_notes:your-password@127.0.0.1:55432/linked_notes npm run prisma:migrate
DATABASE_URL=postgresql://linked_notes:your-password@127.0.0.1:55432/linked_notes npm run dev -- --port 3100
PLAYWRIGHT_EXTERNAL_SERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 npm run test:e2e
```

## Database changes

Edit `prisma/schema.prisma`, run `npm run prisma:migrate -- --name <short-name>` against a disposable development database, inspect the generated SQL, and commit both schema and migration. Production runs `prisma migrate deploy` in a one-shot Compose service; a failed migration prevents the app from starting.

## Dependency pins

Dependabot proposes npm, Actions, and Docker updates. GitHub Actions references use full commit SHAs with the readable release in a comment. Review upstream release notes and update the SHA and comment together.
