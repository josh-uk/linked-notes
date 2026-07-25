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
portable backup or a normal Markdown folder archive.

![Linked Notes desktop workspace showing local AI writing tools, semantic search, notes, folders, and tags](docs/screenshots/linked-notes-desktop.jpg)

## Highlights

- **Desktop-first workspace.** A stable three-pane layout keeps navigation,
  note selection, and writing visible together, with a responsive tablet and
  mobile flow when the window narrows.
- **Keyboard productivity.** <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>K</kbd> opens a
  desktop command centre for quick capture, daily notes, templates, local-AI
  cleanup, note opening, and workspace import/export.
- **Recoverable writing.** Bounded note history makes earlier titles and content
  previewable and restorable, while daily dates and reusable templates turn
  repeated writing into explicit, editable notes.
- **Durable note links.** Type `@` to connect a note. Links follow title changes,
  backlinks include nearby context, and removed targets remain explicit rather
  than silently disappearing.
- **Optional local AI.** A click-to-run Ollama assistant can summarise and
  rewrite selected text, identify likely duplicates, search by meaning, answer
  with linked note sources, and suggest folders for unfiled notes. Results
  remain reviewable until explicitly applied, and note text never goes to a
  hosted AI service.
- **Focused rich-text editing.** Headings, lists, checklists, quotes, code,
  links, undo/redo, keyboard creation, debounced autosave, and conflict recovery
  are built in.
- **Organisation and retrieval.** Nested folders, coloured tags, pinning,
  archive/trash lifecycles, bulk actions, attachment filters, and PostgreSQL
  full-text search scale with the workspace.
- **Local files and exports.** Streamed attachments, safe image previews,
  single-note Markdown and deterministic PDF exports, full Markdown workspace
  archives, reviewed Markdown/Apple Notes migration, storage reconciliation,
  and complete portable backups are available from the desktop workspace.
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

### Enable the optional local AI assistant

On Apple silicon, run Ollama natively so inference uses Metal while Linked Notes
remains in Docker. The default models require about 4 GB of downloaded storage:

```bash
brew install ollama
brew services start ollama
ollama pull qwen3.5:4b
ollama pull qwen3-embedding:0.6b
curl http://127.0.0.1:11434/api/tags
```

Enable the integration in the private `.env` file:

```dotenv
AI_ENABLED=true
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_CHAT_MODEL=qwen3.5:4b
OLLAMA_EMBEDDING_MODEL=qwen3-embedding:0.6b
AI_REQUEST_TIMEOUT_MS=120000
```

Recreate the app container after changing its environment:

```bash
docker compose up --build -d app
```

Expand **AI assistant** below a note to summarise it, find connections, or
rewrite selected text. The writing tools can shorten, clarify, proofread, make
bullets, expand an outline, change tone, or translate. Every result is a preview
until you deliberately insert or replace text through the normal autosave path.

Choose **Meaning** beside the note search box and explicitly run a semantic
search, or open **Ask notes** to answer a question with clickable source notes.
In **Folders**, **Suggest folders** scans active and archived unfiled notes and
lets you review, correct, select, and apply each proposed move. None of these
actions runs in the background or mutates notes automatically.

![Ask your notes showing a grounded local AI answer with its source note](docs/screenshots/linked-notes-ai-workspace.jpg)

Open the command centre and choose **AI cleanup** to scan for likely duplicates,
useful links, missing tags, generic titles, and stale notes. The queue is
review-only: each suggestion can be opened, dismissed, or explicitly applied.

![Desktop local-AI workspace cleanup queue with reviewable title and tag suggestions](docs/screenshots/workspace-cleanup-desktop.png)

Ollama needs internet access only while models are pulled. Inference requests
travel from the app container to the configured host endpoint and are not sent
to Ollama's cloud or another provider. Keep Ollama local, do not configure a
remote `OLLAMA_BASE_URL`, and see [troubleshooting](docs/troubleshooting.md) if
the status remains unavailable.

### Run the released containers

The public release images support Linux amd64 and arm64. Check out the matching
release source so the Compose file and both images stay in lockstep:

```bash
git clone --branch v1.1.0 --depth 1 https://github.com/josh-uk/linked-notes.git
cd linked-notes
cp .env.example .env
```

Set a unique password in `.env`, then set these matching image values:

```dotenv
APP_IMAGE=ghcr.io/josh-uk/linked-notes:1.1.0
MIGRATE_IMAGE=ghcr.io/josh-uk/linked-notes-migrate:1.1.0
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
- Press <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>K</kbd> for the command centre or
  <kbd>Shift</kbd>+<kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>N</kbd> for quick capture.
  Open today's note, create from a template, or save the current note as a
  reusable template without leaving the desktop workspace.
- Choose **Version history** in the editor header to preview an earlier saved
  title and body before restoring it. A restore captures the current content as
  another recoverable version.
- Type `@` to search active notes and insert a durable link. Select a mention to
  open its target; expand **Backlinks** to review source notes and context.
- Expand **AI assistant** to run a local summary, connection scan, or previewed
  rewrite of selected text. Review the result before replacing or inserting
  normal saved note content.
- Switch search from **Keyword** to **Meaning** for an explicitly submitted
  semantic search. Use **Ask notes** for an evidence-bound answer with clickable
  sources.
- Open **Folders → Suggest folders** to review local-AI destinations for every
  non-empty unfiled note. Low-confidence suggestions start unselected and every
  destination remains editable before applying.
- Open **AI cleanup** from the command centre to review workspace-wide duplicate,
  link, tag, title, and stale-note suggestions. It runs only when clicked.
- Search from the note list combines with folder, tag, lifecycle, and attachment
  filters; switch to **Meaning** only when semantic ranking is useful.
- Create nested folders and coloured tags from the left sidebar. Selection mode
  applies move, tag, pin, archive, restore, or trash actions to up to 100 notes
  transactionally.
- Add files with the picker, drag and drop, or clipboard paste. Local raster
  images receive safe previews; every supported file remains downloadable.
- Export the selected note as Markdown or PDF from its desktop editor header.
  PDF export can include local images, metadata, and bounded backlink context.
- Choose **Export Markdown** in the command centre for a gzip-compressed folder
  archive of every note plus attachment bytes. **Import notes** previews up to
  100 Markdown files, preserves nested folders and tags, reconnects exported
  note links, and skips an already imported source by default.
- Use **Settings → Portable backup** to download or restore the complete
  versioned workspace. Replace restore requires an explicit confirmation and
  produces a safety backup before changing live data.

### Import from Apple Notes on macOS

Apple Notes has no built-in bulk export. From a source checkout, run the
included host-side exporter into a new or empty folder:

```bash
npm ci
npm run apple-notes:export -- ~/Desktop/linked-notes-apple-import
```

macOS asks whether Terminal may control Notes. The exporter uses Notes'
automation interface—not its private database—to preserve accounts, nested
folders, titles, note text, and creation/modification dates as Markdown. It also
copies attachments Apple permits into companion folders and records locked,
truncated, or unsaveable items in `apple-notes-import-report.json`.

Then open Linked Notes, press <kbd>Cmd</kbd>+<kbd>K</kbd>, choose **Import
notes**, select the generated folder, review the preview, and import. Repeating
the same migration is safe because Apple note identities are retained and
already imported sources are skipped. Companion attachment files are not
automatically attached to the new notes; upload any you want to retain after
review. See the complete [import and export guide](docs/import-export.md).

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

When local AI is enabled, saved note titles and plain text cross one additional
trust boundary into the configured Ollama process. Linked Notes never sends
attachments, credentials, database URLs, or complete editor JSON to Ollama,
never logs AI prompt or response content, and never falls back to a cloud model.

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
| Data       | [Backup format](docs/backup-format.md), [import/export](docs/import-export.md), [attachments](docs/attachments.md) |
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
