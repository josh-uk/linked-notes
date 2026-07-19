# Development

## Requirements

- Node.js 22 or newer and npm 11
- Docker Engine and Docker Compose v2
- Git and GitHub CLI for delivery work

Install with `npm ci`. Copy `.env.example` to `.env`, replace the password in both relevant variables, and start PostgreSQL with `docker compose up -d db`.

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

## Database changes

Edit `prisma/schema.prisma`, run `npm run prisma:migrate -- --name <short-name>` against a disposable development database, inspect the generated SQL, and commit both schema and migration. Production runs `prisma migrate deploy` in a one-shot Compose service; a failed migration prevents the app from starting.

## Dependency pins

Dependabot proposes npm, Actions, and Docker updates. GitHub Actions references use full commit SHAs with the readable release in a comment. Review upstream release notes and update the SHA and comment together.
