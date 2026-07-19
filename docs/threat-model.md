# Threat model

Linked Notes protects one local user's notes and attachments from accidental loss and unsafe content processing. It does not protect data from an administrator of the host, a process with Docker access, filesystem access to volumes, or an attacker who can reach an intentionally exposed unauthenticated port.

## Trust boundaries

- Browser input crosses into Next.js route handlers and server actions.
- Database values cross into rendered rich text and exports.
- Upload streams cross into an attachment volume and later into download responses.
- Backup archives cross into a staging area before validation and import.
- Print HTML crosses into a sandboxed local Chromium process.

## Baseline controls

Boundary data is schema-validated; rich text and URLs are sanitised; database access is parameterised through Prisma; filenames never become storage paths; downloads disable MIME sniffing; destructive operations require confirmation; optimistic versions prevent silent overwrites; logs exclude note bodies and attachment bytes. The Compose port binds to loopback and its application network has no outbound route.

The database and application share an internal-only backend network. Each also joins a frontend bridge so Docker Desktop can publish loopback-bound application and development-database ports; neither port binds to the LAN by default, and application code makes no external runtime requests. Security work in Phase 6 will add and verify CSP, stored-XSS cases, unsafe-scheme rejection, archive traversal/bomb controls, print-renderer network denial, explicit egress controls where practical, logging review, keyboard safety, and scanning evidence.
