# Backup format

The portable backup format will be implemented in Phase 5. Its stable boundary is a compressed archive containing a versioned JSON manifest plus deterministic attachment paths. The manifest will record application and schema versions, creation time, entity data, attachment metadata, per-file SHA-256 checksums, and its own checksum.

Restore will stage and validate the complete archive before changing live data. Paths must be relative, normalised, and confined to the staging directory. Limits on entry count, expanded size, compression ratio, and individual file size will prevent archive bombs. Replace mode will create a safety backup; merge mode will remap colliding IDs while preserving links.

Until that feature lands, back up the PostgreSQL and attachment named volumes together while writes are stopped. A database-only copy is incomplete.
