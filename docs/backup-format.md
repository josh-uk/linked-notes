# Backup, restore, and recovery

Linked Notes backup schema 1 is a gzip-compressed POSIX tar archive with the
extension `.linked-notes-backup.tar.gz`. Create and restore archives from
**Workspace Settings → Portable backup**. The workflow is designed for the
desktop workspace: downloads are normal browser files and restore reports remain
visible until the user reloads the workspace.

## Archive layout

Entries are regular files only and appear in this order:

```text
manifest.json
manifest.sha256
attachments/<attachment UUID>
attachments/<attachment UUID>
...
```

Attachment paths use the attachment record's immutable UUID, never its display
name or storage filename. Entries are sorted by UUID. Tar headers use mode
`0600`, numeric owner/group zero, and the Unix epoch so packaging metadata is
repeatable. `manifest.sha256` contains the lowercase SHA-256 of the exact
`manifest.json` bytes in standard two-space checksum format. The download
response also exposes the complete archive and manifest SHA-256 values in
`X-Linked-Notes-Archive-Sha256` and `X-Linked-Notes-Manifest-Sha256`.

The strict JSON manifest records:

- format name, backup-schema version, data-schema version, application version,
  and UTC creation time;
- schema metadata, folders, tags, canonical Tiptap note JSON, note/tag joins,
  durable note-link rows, typed settings, and attachment metadata;
- original entity IDs and timestamps, lifecycle state, optimistic versions, and
  folder/tag/link relationships; and
- each attachment's deterministic archive path, byte count, detected MIME type,
  optional image dimensions, and SHA-256.

Derived note plain text and sanitized HTML are deliberately omitted. Restore
regenerates both from validated canonical editor JSON. Physical attachment
storage names are recorded for diagnostics but are never trusted or reused;
restore always assigns fresh opaque UUID filenames.

## Consistency and generation

The database portion is captured in one repeatable-read transaction. The server
then streams each immutable attachment into a temporary archive while recomputing
its checksum. A missing, changed-size, or checksum-invalid attachment fails the
whole backup. The completed file is checksummed before a response begins and is
removed after the response stream closes. Temporary work files older than 24
hours are cleaned during later backup runs.

A backup can represent writes committed before its database snapshot. Writes
committed afterward appear in the next backup. If attachment integrity is already
damaged, run **Check attachment storage** in Workspace Settings and repair or
recover the bytes before trying again.

## Restore validation

The server never extracts client paths directly. It streams the upload through
compressed-byte, gzip, expanded-byte, and tar-entry limits and writes only
validated attachment UUIDs into a newly generated private staging directory.
Before any live mutation it requires all of the following:

- a complete upload whose declared `Content-Length`, when present, is exact;
- a valid gzip/tar stream containing only unique regular-file entries with
  relative canonical paths (no absolute paths, `..`, `.`, empty segments,
  backslashes, drive paths, links, or devices);
- configured compressed-size, expanded-size, entry-count, manifest-size,
  individual attachment-size, and compression-ratio limits;
- the exact two manifest entries and no unexpected entries;
- a valid manifest checksum and strict supported manifest/data-schema versions;
- unique IDs and valid folder depth/parents, case-insensitive sibling names,
  normalized tags, note/tag relationships, and note mention/link reconciliation;
  and
- an exact attachment set whose sizes and SHA-256 values match the manifest and
  whose content-sniffed MIME/dimensions match the recorded safe metadata.

Corrupt, incomplete, oversized, incompatible, traversal, duplicate, link-entry,
checksum-invalid, MIME-forged, and archive-bomb inputs are rejected and the
staging directory is removed. They do not create a safety backup, move imported
bytes, or mutate the live database.

Default limits are configurable in `.env`:

| Variable                       |       Default | Purpose                                |
| ------------------------------ | ------------: | -------------------------------------- |
| `MAX_UPLOAD_BYTES`             |   104,857,600 | Maximum size of one attachment         |
| `MAX_BACKUP_ARCHIVE_BYTES`     | 2,147,483,648 | Maximum compressed upload              |
| `MAX_BACKUP_EXPANDED_BYTES`    | 4,294,967,296 | Maximum expanded tar stream            |
| `MAX_BACKUP_MANIFEST_BYTES`    |    26,214,400 | Maximum manifest entry                 |
| `MAX_BACKUP_ENTRIES`           |        50,000 | Maximum tar entries                    |
| `MAX_BACKUP_COMPRESSION_RATIO` |         5,000 | Maximum live expanded/compressed ratio |

Choose limits large enough for the complete workspace but no larger than the
host can safely stage on the attachment volume.

## Merge and replace

**Merge** leaves existing rows and bytes in place. Imported note and attachment
ID collisions receive new UUIDs. Folder nodes with the same case-insensitive
name under the same mapped parent and tags with the same normalized name map to
the existing entity. Imported settings only fill missing keys. Note JSON,
normalized link rows, attachment ownership, and durable missing-target keys are
remapped together, preserving internal links without pointing at an unrelated
existing note.

**Replace** requires typing the exact word `REPLACE`; the server enforces this
independently of the UI. After full validation and before moving imported bytes,
the server creates a complete safety backup under `.safety-backups/` on the
attachment volume. Imported bytes receive fresh physical names. All relational
replacement occurs in one serializable PostgreSQL transaction, so other readers
see either the old workspace or the complete new workspace. A transaction
failure removes imported bytes and the provisional safety backup. After commit,
old attachment bytes are removed and the safety backup is retained with its
SHA-256 and download link.

The small filesystem/database crash windows can leave only unreferenced bytes;
they cannot expose a partially written imported file through committed metadata.
The existing attachment reconciliation workflow detects and removes those
orphans.

## Recovery procedure

1. Download a fresh full backup and keep the browser download until it has
   completed. Record the archive checksum response header when independently
   tracking backup integrity.
2. Select the archive in Workspace Settings and choose **Merge** or **Replace**.
   For replacement, type `REPLACE` and confirm **Validate and restore**.
3. Wait for **Restore complete**. Do not restart the service during validation or
   import. For replacement, immediately download the offered safety backup.
4. Choose **Reload workspace**, inspect representative notes and attachments,
   then run **Check attachment storage**.
5. To undo a replacement, upload its safety backup in **Replace** mode. That
   recovery itself creates another safety backup, so the operation remains
   reversible.

Retained safety backups can also be listed with `GET /api/backups/safety` and
downloaded from the returned local URL. They contain private workspace data and
must be protected like the live PostgreSQL and attachment volumes. Linked Notes
does not currently expire them automatically; remove old copies only after a
tested independent backup exists.

Never use `docker compose down --volumes` as a recovery step: it permanently
removes the live PostgreSQL and attachment volumes.
