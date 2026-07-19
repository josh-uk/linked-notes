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
