# Linked Notes

Linked Notes is a deliberately simple, local-only note-taking application with durable links between notes. It combines a calm writing experience with local PostgreSQL storage, persistent attachments, portable backups, and no account, telemetry, cloud service, or runtime internet dependency.

The current application includes the responsive workspace, rich-text note editing,
debounced autosave, optimistic-concurrency conflict recovery, pinning, trash and
restore, and light, dark, and system themes. Durable links between notes arrive in
Phase 2.

## Quick start

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
- Use **Pinned** and **Trash** in the workspace navigation to find lifecycle views.
- On smaller screens, use the back and menu buttons to move between the editor,
  note list, and workspace navigation.

Notes are soft-deleted in Phase 1. Permanent deletion is deliberately deferred so
later phases can protect links and attachments before destructive removal exists.

## Safety and privacy

Linked Notes is single-user software with no authentication. Keep the default loopback binding. Exposing its port to a LAN or the internet exposes the complete workspace to anyone who can reach it. Back up both the database and attachment volume before upgrades.

## Project documentation

- [Architecture](docs/architecture.md)
- [Development](docs/development.md)
- [Backup format](docs/backup-format.md)
- [Threat model](docs/threat-model.md)
- [Release process](docs/releases.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Licence

Linked Notes is licensed under the [MIT License](LICENSE).
