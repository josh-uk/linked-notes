# Changelog

All notable changes to Linked Notes will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Repository, application, database, test, container, documentation, and delivery foundation.
- Responsive three-pane and mobile-stack notes workspace with light, dark, and system themes.
- Paginated note creation, selection, rich-text editing, pinning, trash, and restore flows.
- Versioned editor JSON validation with derived plain text, sanitised HTML, and safe paste handling.
- Debounced autosave, session draft recovery, optimistic concurrency, and explicit conflict resolution.
- Keyboard creation and navigation, visible focus and save states, accessible controls, and automated Axe checks.
- Debounced, cancellable `@` note suggestions with keyboard and pointer selection,
  prefix-first ranking, explicit self-links, and accessible loading, empty, and
  error states.
- Rename-safe durable mention nodes, lifecycle-aware and broken-reference
  rendering, grouped contextual backlinks, and transactional link reconciliation.
- Guarded permanent deletion for trashed notes with retained inbound target
  identity and migration-safe nullable live relationships.
- Desktop-first nested folder and coloured tag organization with cycle/depth
  protection, explicit destructive choices, atomic note placement, and stable
  tag associations across edits.
- Archive, guarded permanent deletion, configurable opt-in trash retention,
  sortable/filterable note lists, and transactional bulk lifecycle, move, and tag
  actions with stale-selection rollback.
- Ranked and highlighted PostgreSQL full-text search across weighted titles and
  plain-text bodies, lifecycle/folder/tag/attachment filters, pagination, and a
  reviewed expression GIN index.
- Reproducible 10,000-note search/list performance profiling and desktop
  Playwright coverage for organization, search, lifecycle, bulk actions, crowded
  sidebar scrolling, and accessibility.
- Raw streamed arbitrary-file ingestion with a configurable 100 MiB default,
  generated opaque storage names, single-pass SHA-256/size enforcement,
  signature-derived safe MIME, bounded image-dimension inspection, and explicit
  database/filesystem compensation.
- Desktop file picker, drag/drop, clipboard-image attachment flows, progress,
  cancellation, recoverable retry, safe raster previews, generic file cards,
  byte-for-byte downloads, attachment filtering, and deliberate removal.
- Missing/corrupt/orphan/stale-stage reconciliation, attachment-volume health,
  permanent-note/retention byte cleanup, restart persistence evidence, and a
  reproducible 96 MiB bounded-memory Docker profile.
- Desktop note export to readable Markdown and deterministic A4 PDF with rich
  formatting, local checksum-verified raster images, attachment metadata,
  optional backlinks, and a network-denied Chromium print boundary.
- Versioned streamed full-workspace backups with canonical manifests,
  deterministic attachment paths, per-file and manifest SHA-256, strict archive
  limits and traversal/bomb defenses, transactional merge/replace restore,
  collision-safe durable-link remapping, and automatic replace safety backups.
