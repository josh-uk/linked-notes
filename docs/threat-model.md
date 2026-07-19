# Threat model

Linked Notes protects one local user's notes and attachments from accidental loss and unsafe content processing. It does not protect data from an administrator of the host, a process with Docker access, filesystem access to volumes, or an attacker who can reach an intentionally exposed unauthenticated port.

## Trust boundaries

- Browser input crosses into Next.js route handlers and server actions.
- Database values cross into rendered rich text and exports.
- Upload streams cross into an attachment volume and later into download responses.
- Backup archives cross into a staging area before validation and import.
- Print HTML crosses into a sandboxed local Chromium process.

## Baseline controls

Boundary data is schema-validated; rich text and URLs are sanitised; database access is parameterised through Prisma; filenames never become storage paths; downloads disable MIME sniffing; destructive operations require confirmation; optimistic versions prevent silent overwrites; logs exclude note bodies and attachment bytes. Mention suggestions and contexts are inserted into the DOM as text rather than HTML, mention attributes require UUIDs and bounded fallback labels, and duplicate mention-instance IDs are rejected. Link-index reconciliation shares the note-save transaction, preventing a rejected stale write from corrupting backlinks. Permanent deletion requires a trashed note and matching optimistic version, while inbound references retain only non-secret IDs, fallback labels, and bounded source context.

The Compose port binds to loopback and its application network has no outbound route.

Folder and tag names, search strings, filters, sort choices, bulk selections, and
retention settings are strictly bounded at the route boundary. Full-text search
uses Prisma SQL values rather than string interpolation, and highlighted database
fragments are rendered through a marker parser rather than `innerHTML`. Bulk
mutations run in one transaction and reject stale versions. Folder deletion and
permanent note deletion require deliberate UI confirmation; permanent deletion
is also server-guarded to already-trashed notes. Automatic retention is opt-in,
defaults to never, and preserves inbound mention identity when it removes an
expired target.

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

The database and application share an internal-only backend network. Each also
joins a frontend bridge so Docker Desktop can publish loopback-bound application
and development-database ports; neither port binds to the LAN by default, and
application code makes no external runtime requests. Security work in Phase 6
will add and verify CSP, stored-XSS cases, unsafe-scheme rejection, archive
traversal/bomb controls, print-renderer network denial, explicit egress controls
where practical, logging review, keyboard safety, and scanning evidence.
