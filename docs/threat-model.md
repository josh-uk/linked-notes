# Threat model

Linked Notes protects one local user's notes and attachments from accidental loss and unsafe content processing. It does not protect data from an administrator of the host, a process with Docker access, filesystem access to volumes, or an attacker who can reach an intentionally exposed unauthenticated port.

## Trust boundaries

- Browser input crosses into Next.js route handlers and server actions.
- Database values cross into rendered rich text and exports.
- Upload streams cross into an attachment volume and later into download responses.
- Backup archives cross into a staging area before validation and import.
- Print HTML crosses into a sandboxed local Chromium process.
- When explicitly enabled and invoked, bounded saved note text crosses from the
  application container into a user-configured local Ollama process.

## Baseline controls

Boundary data is schema-validated; rich text and URLs are sanitised; complete
editor documents have aggregate depth, node, and text limits; database access is
parameterised through Prisma; filenames never become storage paths; downloads
disable MIME sniffing; destructive operations require confirmation; optimistic
versions prevent silent overwrites; logs exclude note bodies and attachment
bytes. Mention suggestions and contexts are inserted into the DOM as text rather
than HTML, mention attributes require UUIDs and bounded fallback labels, and
duplicate mention-instance IDs are rejected. Link-index reconciliation shares
the note-save transaction, preventing a rejected stale write from corrupting
backlinks. Permanent deletion requires a trashed note and matching optimistic
version, while inbound references retain only non-secret IDs, fallback labels,
and bounded source context.

The Compose ports bind to loopback. The optional Ollama integration adds one
configured host HTTP destination to the server process; it is disabled by
default and is never called from browser code or without a user action.

Folder and tag names, search strings, AI questions, selected writing text,
filters, sort choices, bulk selections, and retention settings are strictly
bounded at the route boundary. Full-text search uses Prisma SQL values rather
than string interpolation, and highlighted database fragments are rendered
through a marker parser rather than `innerHTML`. Bulk mutations run in one
transaction and reject stale versions. Folder deletion and permanent note
deletion require deliberate UI confirmation; permanent deletion is also
server-guarded to already-trashed notes. Automatic retention is opt-in, defaults
to never, and preserves inbound mention identity when it removes an expired
target.

Attachment requests bypass multipart/body aggregation and stream raw bytes with a
server-enforced maximum. Display filenames are control-stripped, normalized,
bounded, and never used as paths; storage names are server-generated UUIDs and
validated again before every filesystem operation. SHA-256 and byte counts are
computed while writing, declared lengths must match, partial stages are removed,
and the database transaction is compensated if final metadata cannot commit.
Client MIME is only a hint: signatures determine the safe stored/download type,
active or misleading content falls back to an attachment-only octet stream, and
only four raster formats can render inline. Download headers prevent sniffing and
header injection. Reconciliation exposes counts and opaque IDs/names, not file
contents or host paths, and repair is deliberately limited to bytes no metadata
references.

Portable restore treats every archive field and byte as hostile. Compressed and
expanded counters, a live compression-ratio ceiling, entry/manifest/file limits,
strict regular-file types, canonical relative paths, duplicate/unexpected-entry
rejection, manifest and attachment checksums, content-derived MIME/dimensions,
schema compatibility, and relational validation all run before live mutation.
Archive paths never choose staging filesystem paths. Replace also requires the
literal confirmation token and creates a checksum-reported safety backup first;
its database replacement is one serializable transaction with compensating
cleanup for prepared files.

Print export builds self-contained HTML from sanitized canonical content and
escaped metadata. Only checksum-verified local safe raster bytes become `data:`
images. Chromium runs with JavaScript and service workers disabled, background
network features suppressed, host resolution denied, and request interception
that aborts any non-local resource. A blocked request fails the export instead
of producing a document with externally retrieved content.

AI configuration accepts only bounded model names and an HTTP(S) server URL from
the trusted server environment; requests cannot supply or override either.
Prompts frame note bodies as untrusted data and explicitly reject instructions
inside them. Inputs, responses, and exception messages are bounded; model
requests time out; structured responses are schema-validated; suggested note IDs
must belong to the server-selected shortlist; Ask-notes answers require a
validated server-selected citation; rewrite selections must still exist in the
saved note; and output renders as React text.
The feature sends no attachment bytes, credentials, URLs from note content,
editor HTML, or database connection data. There is no tool execution, cloud
fallback, automatic note mutation, background scan, or persistent AI cache.

The database and application share an internal-only backend network. Each also
joins a frontend bridge so Docker Desktop can publish loopback-bound application
and development-database ports; neither port binds to the LAN by default.
Application code makes no runtime request beyond the explicitly enabled,
configured Ollama host endpoint. Production pages use a
per-request-nonce CSP plus restrictive browser headers, startup checks validate
environment/storage/schema assumptions, and full-history secret scanning,
dependency audit, JavaScript/TypeScript security-pattern analysis, and
exact-runner image scanning gate delivery. Direct regressions cover stored XSS,
unsafe schemes, private-error redaction, and PDF network denial. See the
[security and privacy audit](security-audit.md) for the test matrix, logging
review, scanner policy, account capability limit, and remaining trust
assumptions.
