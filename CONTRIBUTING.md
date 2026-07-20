# Contributing

Development is organised as one GitHub issue and one feature branch per coherent
change. The sole default branch is `master`.

1. Open or select an issue with acceptance criteria and verification commands.
2. Branch from current `master` using `phase/<number>-<name>` for phase work or `fix/<issue>-<name>` for focused repairs.
3. Add implementation, tests, migrations, and documentation together.
4. Run `npm run check` and the relevant integration, migration, browser,
   security, and release-image checks documented in `docs/development.md`.
5. Open a pull request that closes the issue and complete every template section.

Never commit secrets, private notes, attachment samples from real users, generated build output, or local `.env` files. Database changes require a reviewed Prisma migration. Pull requests must not weaken a check to conceal a failure.

Release changes additionally update the package/lockfile version, dated
changelog, upgrade and recovery notes, and release evidence. Tags are created
only from fully verified merged `master`; contributors must never move or reuse a
published tag.
