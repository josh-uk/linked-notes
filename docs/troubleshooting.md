# Troubleshooting

Start with `docker compose ps`, `docker compose logs --tail=200 migrate app db`,
and `GET /api/health`. Preserve the logs and a fresh portable backup before any
repair that changes storage.

## The app is not healthy

- If `migrate` exited non-zero, read its log first. Confirm `DATABASE_URL` uses
  the Compose host `db`, the password matches `POSTGRES_PASSWORD`, and app plus
  migration image tags belong to the same release. Do not mark a failed
  migration as applied manually.
- If the database is unreachable, check `db` health and free disk space. Host
  port conflicts affect host development access, not the internal `db:5432`
  connection.
- If attachments are not writable, confirm the named volume is mounted at
  `/data/attachments`. Do not make the complete container root writable.
- If a configured port is busy, change `APP_PORT` or `POSTGRES_PORT` in `.env`;
  keep `APP_HOST=127.0.0.1`.

## Notes do not save or a conflict appears

The editor preserves a session recovery draft and reports optimistic conflicts.
Choose **Keep my draft** only when the local version should overwrite the latest
server version; choose **Reload latest** to keep the server copy while retaining
the local draft as recoverable text. Check app logs for an error class, not note
content.

## Attachment is missing or corrupt

Run **Check attachment storage**. A missing or changed byte returns an unavailable
card/HTTP 410; metadata is not silently discarded. Restore the complete portable
backup or coordinated volume snapshot. Automatic repair removes only
unreferenced/stale bytes, never missing/corrupt metadata.

## PDF export fails

The runner requires its bundled Alpine Chromium and writable bounded `/tmp`.
Confirm the app image matches the documented release and `/tmp` tmpfs exists.
Any non-data network request in print HTML is deliberately blocked and fails the
export. Do not fix this by enabling Chromium networking or JavaScript.

## Backup or restore fails

Check free attachment-volume space and configured archive/expanded/entry limits.
Validation rejects corrupt, truncated, traversal, duplicate, MIME-forged, or
expansion-bomb archives before mutation. Do not extract and edit an archive to
force acceptance. Return to the original checksum-verified backup.

After a successful replace, download the offered safety backup immediately. If
the restored workspace is wrong, replace-restore that safety backup; the recovery
creates another safety backup and remains reversible.

## Upgrade fails

Stop the app, keep both volumes, and retain migration logs. If migration did not
commit, correct the configuration and rerun the same release migration image. If
it committed but the app is unusable, follow the coordinated rollback procedure
in [releases and upgrades](releases.md). An older image against a newer database
is not assumed safe.

## Last resort

Open a synthetic-data bug report with the app version, architecture, image
digest, Compose/Docker versions, health response, error classes, and exact
reproduction. Never attach private notes, original attachments, `.env`, database
URLs, access tokens, or raw backups to a public issue. Security reports follow
[the security policy](../SECURITY.md).
