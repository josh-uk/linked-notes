# Import and export

Linked Notes supports ordinary Markdown as a migration format and its versioned
portable backup as the complete disaster-recovery format. Use Markdown when
moving readable notes between applications; use a portable backup when folder
IDs, settings, attachments, history, templates, and every relationship must be
restored exactly.

## Import Markdown

Press <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>K</kbd>, choose **Import notes**, then
select individual `.md` files or a folder. Linked Notes reads the files locally
in the browser, sends them only to the local app, and shows a preview before
committing anything.

One request accepts at most 2,000 files, 2,000,000 characters per file, and
20,000,000 characters in total. Import paths must be relative, bounded, free of
traversal segments, and no more than six folders deep. Nested directories become
nested Linked Notes folders. Simple front matter can preserve:

```yaml
---
title: Project plan
created: 2026-07-01T10:00:00.000Z
updated: 2026-07-20T15:30:00.000Z
tags: [Project, Planning]
linked-notes-source: markdown
linked-notes-source-id: project-plan-v1
---
```

The first level-one heading supplies the title when front matter omits it.
Linked Notes' own Markdown metadata and
`@Title` links with a `linked-notes://note/<UUID>` target are recognised. When linked files
are imported together, immutable targets are remapped to their new note IDs and
normal backlink reconciliation runs after every note exists.

`linked-notes-source` plus `linked-notes-source-id` is an idempotency key. A
later preview identifies an existing source and import skips it unless a future
workflow explicitly asks to create copies.

## Import Apple Notes on macOS

Apple documents Markdown export for one selected note, but does not provide bulk
export in Notes. Linked Notes includes a bounded host-side exporter that uses
the installed Notes application's scripting dictionary instead of reading
Apple's private Core Data database.

From the repository checkout:

```bash
npm ci
npm run apple-notes:export -- ~/Desktop/linked-notes-apple-import
```

The destination must be new or empty. The first run triggers the standard macOS
Automation permission for Terminal controlling Notes. The exporter:

- walks accounts and nested folders;
- converts each note's HTML body to Markdown, falling back to plain text;
- preserves Apple note identity and creation/modification timestamps;
- bounds the export at 10,000 notes and 2,000,000 characters per note;
- attempts to save each attachment into a hidden companion directory; and
- writes `apple-notes-import-report.json` with every truncation, locked note, or
  attachment Notes would not save.

After export, choose the generated folder in **Import notes**. One reviewed
batch can contain up to 2,000 Markdown files. Apple identities make repeated
batches and reruns skip notes that already arrived when the workspace is larger.

Locked notes may return no readable content until they are unlocked in Notes.
Apple also documents that some attachment kinds, including maps and webpage
previews, cannot be saved. Saveable companion files remain beside the Markdown
for review; they are not silently uploaded as Linked Notes attachments. Upload
the files you want from the destination folder after opening the imported note.

Official Apple references:

- [Import, export and print notes on Mac](https://support.apple.com/en-euro/guide/notes/not201900c07/mac)
- [View attachments in Notes on Mac](https://support.apple.com/guide/notes/apd9953dabf9/mac)

## Export the workspace as Markdown

Choose **Export Markdown** in the command centre. The app streams a
`linked-notes-markdown-YYYY-MM-DD.tar.gz` archive without staging note content in
the browser. Notes are placed beneath `Linked Notes/`, with archived and trashed
notes under explicit `_Archive` and `_Trash` directories. Folder names are
sanitised, filenames carry a short immutable ID to avoid collisions, and raw
attachment bytes live under `_attachments/<note-id>/`.

Extract with:

```bash
tar -xzf linked-notes-markdown-YYYY-MM-DD.tar.gz
```

The Markdown files retain timestamps, note IDs, rich-text structure, and durable
Linked Notes link URLs. This export is readable and re-importable, but it is not
a substitute for a complete portable backup because it intentionally omits
settings and database-only operational metadata.
