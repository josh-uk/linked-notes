# Architecture

Linked Notes is a single Next.js App Router process backed by PostgreSQL and a filesystem attachment store. Docker Compose is the supported installation boundary.

```text
browser on localhost
        |
        v
Next.js standalone app ----> /data/attachments named volume
        |
        v
PostgreSQL named volume
```

React Server Components are the default rendering model. Client components are reserved for editor and interaction state. Server mutations validate boundary input with Zod, use Prisma transactions where records must change together, and return typed domain errors. Server-only modules remain under `src/server`.

Note content is versioned Tiptap JSON. Derived plain text supports excerpts and search; sanitised HTML supports safe rendering and export. Immutable note UUIDs are embedded in mention nodes and mirrored into a normalised link table so titles may change without changing identity.

## Note write path

The browser sends the canonical editor JSON and an expected optimistic version to
the note API. The server validates the document shape and supported formatting,
then derives plain text and sanitised HTML before committing all representations
and the incremented version in one transaction. A stale expected version returns
the current server note without changing either copy; the editor preserves the
local draft and asks the user which version should continue.

The note list is a separate cursor-paginated projection with updated, created,
and title ordering. It returns excerpts, folder/tag/attachment metadata, and
lifecycle timestamps rather than full editor documents, so opening the workspace
does not load every note body. Lifecycle mutations use the same optimistic
version contract for pin, unpin, archive, unarchive, trash, and restore.

Autosave is debounced in the client, but pending work is also flushed when focus
leaves the editor, the document becomes hidden, or the user navigates between
notes and panes. A session-scoped recovery copy protects text when a request fails
or the browser is interrupted.

## Durable links and backlinks

Each canonical mention node stores three bounded attributes: the immutable target
note UUID (`id`), a unique mention-instance UUID (`mentionId`), and the target
title at insertion time (`label`) as a fallback. Opening a note resolves all
distinct target UUIDs in one query. The editor renders the resolved current title
and lifecycle state without mutating the canonical JSON, so renames do not create
write churn in source notes.

Every successful content save reconciles those nodes with `NoteLink` rows inside
the same transaction as the optimistic note update. The row key is the source
note plus mention-instance UUID, which permits several separately contextualised
mentions of the same target. Removed mention instances are deleted during the
same reconciliation. A stale or failed note update never changes the link index.

`NoteLink.targetKey` is the durable target identity used for backlinks, including
after deletion. `targetNoteId` is the nullable live foreign key used while the
target exists. Permanent deletion is restricted to trashed notes; PostgreSQL sets
inbound live keys to null while `targetKey`, the fallback label, and source
contexts remain available as explicit broken references. Deleting a source note
still cascades its outbound rows.

Suggestion search excludes archived and trashed notes and ranks title prefixes
before partial matches, then by recency, in PostgreSQL before applying the
ten-result limit. The client debounces and cancels searches. Backlinks load only
when their panel is expanded and group every bounded context by source note.

The `20260719182000_durable_links` migration backfills `targetKey` from the
previous required target foreign key before making the live key nullable and
changing its deletion action to `SET NULL`. This ordering preserves all existing
relationships during upgrade.

## Organization, lifecycle, and search

Folders are an adjacency list with a maximum depth of six. All create and move
operations walk the parent chain and account for the moved subtree height, so
invalid parents, cycles, and over-depth moves are rejected before mutation.
Deleting a folder is always an explicit transaction: either its direct notes and
child folders move to its parent, or notes throughout the subtree move to Trash
and the subtree is removed. Destination names are checked case-insensitively
before moving children.

Tags have a case-insensitive, whitespace-normalized unique key separate from the
editable display name and colour. `NoteTag` keeps associations stable across tag
renames. Note creation validates and writes its initial folder and tags in the
same transaction. Metadata edits and bulk actions increment optimistic versions;
a stale member causes the complete bulk transaction to roll back.

Archive and Trash are independent timestamps. Active lists exclude both;
archived lists exclude Trash; Trash includes notes regardless of their previous
archive state. Restoring from Trash preserves an earlier archive timestamp, while
restoring from Archive clears it. Mentions and backlinks expose the same active,
archived, trashed, and missing states.

Search uses a parameterized PostgreSQL `websearch_to_tsquery('simple', ...)`
against weighted title and plain-body vectors. The
`20260719193000_organization_search` migration adds the matching expression GIN
index and a lower-title ordering index. Title hits sort before body-only hits,
then by rank and recency. `ts_headline` supplies bounded marker-delimited excerpts;
the React client parses only the fixed `<mark>` markers and never inserts result
HTML. Search is offset-paginated and applies lifecycle, folder, tag, and
attachment-presence filters in SQL. See [performance measurements](performance.md).

Attachment bytes never enter PostgreSQL. Metadata and SHA-256 checksums do. Opaque storage names prevent client filenames from becoming paths. The application root filesystem is read-only in Compose; the attachment volume and bounded temporary filesystem are the intended writable locations.

See [ADR 0001](adr/0001-local-monolith.md), [ADR 0002](adr/0002-versioned-editor-json.md), and [ADR 0003](adr/0003-durable-note-links.md).
