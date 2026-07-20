# Changelog

All notable changes to Linked Notes will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-07-19

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
- Per-request-nonce production CSP, restrictive browser headers, startup
  environment/storage/schema checks, redacted unknown-error handling, and
  aggregate editor depth/node/text limits.
- Keyset-paginated backlinks with a composite index, a bounded 100-mention PDF
  page and truncation notice, plus reproducible search/list/link/save timings over
  10,000 notes and bounded-memory evidence for a 96 MiB upload.
- WCAG 2.2 AA automation in light and dark desktop themes, responsive overflow
  and reduced-motion checks, safe-first keyboard-trapped dialogs, focus
  restoration, and corrected primary/danger colour contrast.
- Full-history Gitleaks, high-severity dependency audit, CodeQL, exact-runner
  Trivy image scanning, and a direct PDF-renderer SSRF regression.
- Clean and earliest-schema migration proofs, private GHCR app/migration images,
  amd64 and arm64 offline release smoke journeys, immutable post-merge tags,
  validated SemVer releases, generated release notes, SPDX SBOMs, provenance,
  scheduled maintenance, and complete operations/upgrade/recovery guidance.

[Unreleased]: https://github.com/josh-uk/linked-notes/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/josh-uk/linked-notes/releases/tag/v1.0.0
