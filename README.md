# Linked Notes

Linked Notes is a deliberately simple, local-only note-taking application with durable links between notes. It combines a calm writing experience with local PostgreSQL storage, persistent attachments, portable backups, and no account, telemetry, cloud service, or runtime internet dependency.

The current application includes a desktop-first three-pane workspace with a
responsive mobile stack, rich-text editing, debounced autosave,
optimistic-concurrency conflict recovery, nested folders, coloured tags, bulk
actions, pin/archive/trash lifecycle controls, PostgreSQL full-text search,
streamed local attachments with image previews, durable `@` links with contextual
backlinks, and light, dark, and system themes.

## Quick start from source

Requirements: Docker Engine with Docker Compose v2.

```bash
cp .env.example .env
# Replace the example password in both POSTGRES_PASSWORD and DATABASE_URL.
docker compose up --build
```

Open <http://127.0.0.1:3000>. The application binds to loopback by default. PostgreSQL and attachment bytes live in the `postgres_data` and `attachment_data` named volumes.

Stop the services without deleting data:

```bash
docker compose down
```

Do not add `--volumes` unless you deliberately intend to delete all local application data.

## Install a released image

The repository and GHCR packages are private, so first authenticate an account
that can read `josh-uk/linked-notes`. Check out the matching release source so
Compose configuration and images stay in lockstep:

```bash
git clone https://github.com/josh-uk/linked-notes.git
cd linked-notes
git checkout v1.0.0
cp .env.example .env
# Replace the password in both POSTGRES_PASSWORD and DATABASE_URL.
# Set APP_IMAGE and MIGRATE_IMAGE in .env to the matching 1.0.0 GHCR tags.
docker login ghcr.io
docker compose pull app migrate
docker compose up -d
docker compose ps
```

Use `ghcr.io/josh-uk/linked-notes:1.0.0` and
`ghcr.io/josh-uk/linked-notes-migrate:1.0.0`. The separate migration image must
complete before the read-only app starts. See [operations](docs/operations.md)
and [releases and upgrades](docs/releases.md) before changing versions.

## Local development

```bash
npm ci
docker compose up -d db
DATABASE_URL=postgresql://linked_notes:your-password@127.0.0.1:5432/linked_notes npm run prisma:migrate
DATABASE_URL=postgresql://linked_notes:your-password@127.0.0.1:5432/linked_notes npm run dev
```

Run the baseline quality gate with `npm run check`. See [development documentation](docs/development.md) for the full workflow.

## Using the workspace

- Choose **New** or press <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>N</kbd> to create a note.
- Edit the title and rich-text body directly. The save indicator reports unsaved,
  saving, saved, failed, and conflicting states.
- Type `@` in a note to search active notes. Use the arrow keys and
  <kbd>Enter</kbd>, or choose a result with the pointer. Linking the current note
  to itself is supported and labelled in the menu.
- Select a mention to open its note. Mentions show the target's current title
  without rewriting the source document, and visibly identify archived, trashed,
  or permanently removed targets.
- Expand **Backlinks** below the editor to page through source notes and each
  nearby context that links to the open note.
- Press <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>K</kbd> to focus search. Search covers
  titles and note bodies, highlights matches, ranks titles first, and combines
  with folder, tag, lifecycle, and attachment filters.
- Create nested folders and coloured tags from their management controls in the
  left sidebar. A note can be moved or tagged from the editor; desktop selection
  mode applies move, tag, pin, archive, restore, or trash actions to up to 100
  notes transactionally.
- Use **Pinned**, **Archive**, and **Trash** for lifecycle views. Restoring an
  archived note returns it to active notes; restoring a trashed archived note
  returns it to the archive.
- Permanent deletion is available only from Trash and requires confirmation.
  Trash retention defaults to **Never** and can be changed in Workspace Settings.
- Use **Add files**, drop files onto the editor, or paste a clipboard image to
  attach local content. PNG, JPEG, GIF, and WebP render as safe previews; every
  type remains downloadable. Upload progress, cancellation, retry, explicit
  removal, missing-byte states, and attachment-presence filtering are available
  from the desktop workspace.
- Export the selected note from its desktop editor header as readable Markdown
  or a deterministic PDF. PDF exports include local raster attachments, metadata,
  and optionally the first 100 backlink mentions with an explicit truncation
  notice, without allowing Chromium to fetch network resources.
- From **Workspace Settings → Portable backup**, download the complete versioned
  workspace archive or stage and validate one for merge/replace restore. Replace
  requires typing `REPLACE` and creates a downloadable safety backup before any
  live data changes.
- Workspace Settings can verify attachment sizes/checksums and identify missing,
  corrupt, staged, or unreferenced bytes. Automatic repair removes only
  unreferenced bytes; it does not discard missing/corrupt metadata silently.
- On smaller screens, use the back and menu buttons to move between the editor,
  note list, and workspace navigation.

Notes are soft-deleted from the workspace. The server's guarded permanent-delete
path only accepts already-trashed notes; inbound mentions retain their immutable
target identity and become explicit broken references.

## Safety and privacy

Linked Notes is single-user software with no authentication. Keep the default
loopback binding. Exposing its port to a LAN or the internet exposes the complete
workspace to anyone who can reach it. Use the full portable backup before
upgrades and keep a verified copy outside the Docker volumes. See
[backup, restore, and recovery](docs/backup-format.md).

## Project documentation

- [Architecture](docs/architecture.md)
- [Development](docs/development.md)
- [Backup format](docs/backup-format.md)
- [Threat model](docs/threat-model.md)
- [Accessibility audit](docs/accessibility.md)
- [Security and privacy audit](docs/security-audit.md)
- [Performance measurements](docs/performance.md)
- [Attachment storage and recovery](docs/attachments.md)
- [Operations](docs/operations.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Releases and upgrades](docs/releases.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Licence

Linked Notes is licensed under the [MIT License](LICENSE).
