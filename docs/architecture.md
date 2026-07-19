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

Attachment bytes never enter PostgreSQL. Metadata and SHA-256 checksums do. Opaque storage names prevent client filenames from becoming paths. The application root filesystem is read-only in Compose; the attachment volume and bounded temporary filesystem are the intended writable locations.

See [ADR 0001](adr/0001-local-monolith.md) and [ADR 0002](adr/0002-versioned-editor-json.md).
