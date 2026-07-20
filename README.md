# Linked Notes

A calm, local-first notes workspace with durable links between ideas.

[![Security](https://github.com/josh-uk/linked-notes/actions/workflows/security.yml/badge.svg?branch=master)](https://github.com/josh-uk/linked-notes/actions/workflows/security.yml)
[![Release](https://github.com/josh-uk/linked-notes/actions/workflows/release.yml/badge.svg)](https://github.com/josh-uk/linked-notes/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/josh-uk/linked-notes)](https://github.com/josh-uk/linked-notes/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-8b6f47.svg)](LICENSE)

Linked Notes is a self-hosted, single-user note-taking application for people
who want a capable desktop writing environment without an account, telemetry,
cloud service, or runtime internet dependency. Notes, attachments, links, and
backlinks stay in a local PostgreSQL-backed workspace and can be exported as a
portable backup.

![Linked Notes desktop workspace showing a release checklist, linked note, folders, and tags](docs/screenshots/linked-notes-desktop.jpg)

## Highlights

- **Desktop-first workspace.** A stable three-pane layout keeps navigation,
  note selection, and writing visible together, with a responsive tablet and
  mobile flow when the window narrows.
- **Durable note links.** Type `@` to connect a note. Links follow title changes,
  backlinks include nearby context, and removed targets remain explicit rather
  than silently disappearing.
- **Focused rich-text editing.** Headings, lists, checklists, quotes, code,
  links, undo/redo, keyboard creation, debounced autosave, and conflict recovery
  are built in.
- **Organisation and retrieval.** Nested folders, coloured tags, pinning,
  archive/trash lifecycles, bulk actions, attachment filters, and PostgreSQL
  full-text search scale with the workspace.
- **Local files and exports.** Streamed attachments, safe image previews,
  Markdown and deterministic PDF exports, storage reconciliation, and complete
  portable backups are available from the desktop workspace.
- **Operationally boring.** Docker Compose, loopback-only defaults, a read-only
  application container, one-shot migrations, health checks, multi-architecture
  images, SBOMs, checksums, and rehearsed restore paths make the workspace
  straightforward to own.

<p align="center">
  <img src="docs/screenshots/linked-notes-mobile.jpg" width="390" alt="Linked Notes responsive mobile note list" />
</p>

## Quick start

### Run from source

Requirements: Docker Engine with Docker Compose v2.

```bash
git clone https://github.com/josh-uk/linked-notes.git
cd linked-notes
cp .env.example .env
```

Replace the example password in both `POSTGRES_PASSWORD` and `DATABASE_URL`,
then start the stack:

```bash
docker compose up --build -d
docker compose ps
```

Open <http://127.0.0.1:3000>. PostgreSQL and attachment bytes live in the
`postgres_data` and `attachment_data` named volumes.

### Run the released containers

The public release images support Linux amd64 and arm64. Check out the matching
release source so the Compose file and both images stay in lockstep:

```bash
git clone --branch v1.0.0 --depth 1 https://github.com/josh-uk/linked-notes.git
cd linked-notes
cp .env.example .env
```

Set a unique password in `.env`, then set these matching image values:

```dotenv
APP_IMAGE=ghcr.io/josh-uk/linked-notes:1.0.0
MIGRATE_IMAGE=ghcr.io/josh-uk/linked-notes-migrate:1.0.0
```

Pull and start the public images; no GitHub sign-in is required:

```bash
docker compose pull app migrate
docker compose up -d
docker compose ps
```

The migration image must complete successfully before the read-only app starts.
For upgrades and recovery, follow [releases and upgrades](docs/releases.md) and
[operations](docs/operations.md).

## Using the workspace

- Choose **New** or press <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>N</kbd> to create a
  note. The save indicator reports unsaved, saving, saved, failed, and conflict
  states.
- Type `@` to search active notes and insert a durable link. Select a mention to
  open its target; expand **Backlinks** to review source notes and context.
- Press <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>K</kbd> to focus full-text search.
  Search combines with folder, tag, lifecycle, and attachment filters.
- Create nested folders and coloured tags from the left sidebar. Selection mode
  applies move, tag, pin, archive, restore, or trash actions to up to 100 notes
  transactionally.
- Add files with the picker, drag and drop, or clipboard paste. Local raster
  images receive safe previews; every supported file remains downloadable.
- Export the selected note as Markdown or PDF from its desktop editor header.
  PDF export can include local images, metadata, and bounded backlink context.
- Use **Settings → Portable backup** to download or restore the complete
  versioned workspace. Replace restore requires an explicit confirmation and
  produces a safety backup before changing live data.

## Data safety

Stop the services without deleting data:

```bash
docker compose down
```

Do not add `--volumes` unless you deliberately intend to delete the database and
all attachment bytes. Create a portable backup before upgrades and keep a
verified copy outside the Docker host.

Linked Notes has no authentication because it is designed for one trusted user
on one machine. Keep the default loopback binding. Setting `APP_HOST=0.0.0.0`
exposes the complete workspace to anyone who can reach that port; it is not a
supported security boundary.

## Development

Requirements: Node.js 22+, npm, and PostgreSQL 18 (Docker is the documented
development database).

```bash
npm ci
docker compose up -d db
DATABASE_URL=postgresql://linked_notes:your-password@127.0.0.1:5432/linked_notes npm run prisma:migrate
DATABASE_URL=postgresql://linked_notes:your-password@127.0.0.1:5432/linked_notes npm run dev
```

Run the baseline quality gate with:

```bash
npm run check
```

The repository also includes PostgreSQL integration, migration, security,
browser, performance, Compose, and release-image suites. See
[development](docs/development.md) for the complete workflow.

## Documentation

| Area       | Guide                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| Design     | [Architecture](docs/architecture.md), [ADRs](docs/adr), [accessibility](docs/accessibility.md)                     |
| Data       | [Backup format](docs/backup-format.md), [attachments](docs/attachments.md)                                         |
| Operations | [Operations](docs/operations.md), [troubleshooting](docs/troubleshooting.md), [releases](docs/releases.md)         |
| Assurance  | [Threat model](docs/threat-model.md), [security audit](docs/security-audit.md), [performance](docs/performance.md) |
| Project    | [Contributing](CONTRIBUTING.md), [security policy](SECURITY.md), [changelog](CHANGELOG.md)                         |

## Contributing and security

Contributions are welcome through issues and pull requests. Read
[CONTRIBUTING.md](CONTRIBUTING.md) before making changes. Please report
vulnerabilities privately using the process in [SECURITY.md](SECURITY.md), not a
public issue.

## License

Linked Notes is released under the [MIT License](LICENSE).
