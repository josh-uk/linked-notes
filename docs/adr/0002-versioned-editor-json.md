# ADR 0002: Versioned editor JSON as source content

- Status: accepted
- Date: 2026-07-19

## Decision

Persist validated, versioned Tiptap JSON as canonical note content. Derive plain text and sanitised HTML on successful saves. Mirror mention relationships transactionally into `NoteLink` rows.

## Consequences

Editor semantics and immutable note references survive rendering changes. Search and exports use reproducible derivatives. Each future document-shape change needs a migration strategy, and every save must validate content and reconcile links atomically.
