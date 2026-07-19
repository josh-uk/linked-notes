# Contributing

Development is organised as one GitHub issue and one feature branch per coherent change. The default branch is `master`; do not create or refer to a `main` branch.

1. Open or select an issue with acceptance criteria and verification commands.
2. Branch from current `master` using `phase/<number>-<name>` for phase work or `fix/<issue>-<name>` for focused repairs.
3. Add implementation, tests, migrations, and documentation together.
4. Run `npm run check` and the relevant integration, browser, and container checks.
5. Open a pull request that closes the issue and complete every template section.

Never commit secrets, private notes, attachment samples from real users, generated build output, or local `.env` files. Database changes require a reviewed Prisma migration. Pull requests must not weaken a check to conceal a failure.
