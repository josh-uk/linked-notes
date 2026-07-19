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

The note list is a separate paginated projection ordered by pinned status and
update time. It returns excerpts and metadata rather than full editor documents,
so opening the workspace does not load every note body. Lifecycle mutations use
the same optimistic version contract for pin, unpin, trash, and restore.

Autosave is debounced in the client, but pending work is also flushed when focus
leaves the editor, the document becomes hidden, or the user navigates between
notes and panes. A session-scoped recovery copy protects text when a request fails
or the browser is interrupted.

Attachment bytes never enter PostgreSQL. Metadata and SHA-256 checksums do. Opaque storage names prevent client filenames from becoming paths. The application root filesystem is read-only in Compose; the attachment volume and bounded temporary filesystem are the intended writable locations.

See [ADR 0001](adr/0001-local-monolith.md) and [ADR 0002](adr/0002-versioned-editor-json.md).
