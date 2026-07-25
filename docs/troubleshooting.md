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

## Local AI is disabled, unavailable, or missing a model

The assistant is optional and disabled unless `AI_ENABLED=true` reaches the app
container. After changing `.env`, recreate the app with
`docker compose up --build -d app`; a restart alone does not apply changed
Compose environment values.

Check native Ollama first:

```bash
brew services list | grep ollama
curl http://127.0.0.1:11434/api/tags
ollama list
```

The configured defaults require both `qwen3.5:4b` and
`qwen3-embedding:0.6b`. Pull a missing model with `ollama pull MODEL_NAME`.
Model names in `.env` must match `ollama list` exactly.

If host Ollama works but the assistant reports it unreachable, check from the
application container:

```bash
docker compose exec app node -e "fetch('http://host.docker.internal:11434/api/tags').then(r=>console.log(r.status)).catch(e=>console.error(e.name))"
```

Keep the endpoint local and do not work around reachability by exposing the
unauthenticated Ollama API to the LAN. Long first requests can include model
load time; increase `AI_REQUEST_TIMEOUT_MS` up to 300000 if required. App logs
contain only error classes and never the note prompt or model response.

Meaning search, Ask notes, folder cleanup, and selection writing are
deliberately click-to-run. If Meaning mode shows older results after changing
the query, press Enter or choose the sparkle button to submit it. Ask notes can
return no answer when its shortlisted notes do not provide direct evidence.
Folder cleanup requires at least one existing folder; matches below 45% begin
unselected and can still be corrected manually. A writing preview becomes
stale when the note or selection changes, so select the current text and run it
again.

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
