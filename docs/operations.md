# Operations

Linked Notes is a local, single-user service. Docker Compose owns the supported
runtime boundary: PostgreSQL data, attachment bytes, a one-shot migration image,
and the read-only application image.

## Installation modes

For a source install, copy `.env.example`, replace the example password in both
places, and run `docker compose up --build -d`. For a release install, set
matching `APP_IMAGE` and `MIGRATE_IMAGE` values, authenticate to GHCR, run
`docker compose pull app migrate`, then `docker compose up -d`. Do not combine
an app image from one release with a migration image from another.

The default ports bind only to loopback. `APP_HOST=0.0.0.0` exposes a completely
unauthenticated private workspace to the attached network and is not a supported
security boundary.

## Start, stop, restart, and health

```bash
docker compose up -d
docker compose ps
docker compose logs --tail=100 migrate app db
docker compose restart app
docker compose stop
```

Stopping or `docker compose down` preserves named volumes. Adding `--volumes`
deletes the live database and attachments and is intentionally absent from all
normal procedures.

The app becomes healthy only when PostgreSQL is reachable and the attachment
directory is writable. The JSON endpoint is `GET /api/health`; a healthy result
reports `status: ok`, `database: reachable`, and `attachments: writable`.
Startup also validates environment values and schema metadata before readiness.

## Storage and capacity

- `postgres_data` contains every relational record.
- `attachment_data` contains attachment bytes, temporary backup stages, and
  retained replace-restore safety backups.
- The application root filesystem is read-only. Only the attachment volume and
  bounded `/tmp` tmpfs are writable.
- Monitor host disk space for both volumes. Backup staging can temporarily need
  space comparable to the complete attachment collection.

Use **Check attachment storage** after unclean shutdowns, restores, or storage
maintenance. It reports missing/corrupt metadata targets and unreferenced or
stale staged bytes without silently deleting referenced metadata.

## Backup and recovery schedule

Create a portable backup before every upgrade and on a schedule appropriate to
the value of the workspace. Keep at least one checksum-verified copy outside the
Docker host. Periodically prove replacement restore in an isolated installation;
an untested archive is not recovery evidence.

Host-level snapshots are a second layer. Stop writes and capture PostgreSQL plus
the attachment volume as one coordinated point; either volume alone is
incomplete. Restore them together. The portable format and reversible replace
procedure are documented in [backup and recovery](backup-format.md).

## Logs and privacy

Normal logs contain readiness state, counts, schema versions, error classes, and
opaque generated storage identifiers. They must not contain titles, bodies,
search terms, original filenames, attachment bytes, database URLs, secrets,
unknown exception messages, or stacks. Treat Docker logs as operational data and
review unexpected output before sharing it.

## Upgrades and maintenance

Use the exact procedure in [releases and upgrades](releases.md). The migration
container is deliberately separate from the app: a failed migration exits
non-zero and prevents app replacement. Do not bypass it by starting the runner
manually against an unknown schema.

Weekly GitHub maintenance runs the complete quality, PostgreSQL integration,
migration, browser, and release-image suite. Security scanning also runs weekly.
Dependabot covers npm, GitHub Actions, and Docker dependencies. A scheduled-run
failure is maintenance work even when application source did not change.
