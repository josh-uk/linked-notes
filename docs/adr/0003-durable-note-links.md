# ADR 0003: Separate durable target identity from the live note relation

- Status: accepted
- Date: 2026-07-19

## Context

A mention must continue to identify its original target after a rename or
permanent deletion. A conventional required foreign key either prevents deletion
or cascades away the backlink evidence. Rewriting every source note on rename
would also create unnecessary writes and optimistic-concurrency conflicts.

## Decision

Store the immutable target UUID and a unique mention-instance UUID in canonical
editor JSON. Mirror each mention into `NoteLink` with a required `targetKey` and a
nullable `targetNoteId` live foreign key. Reconcile the mirror inside the same
transaction as a successful optimistic note save. Resolve current titles and
lifecycle state at read time; retain the insertion-time label only as a fallback.

On permanent target deletion, set the live relation to null and retain
`targetKey`. Backlink lookup always uses `targetKey`. Outbound links cascade only
when their source note is deleted.

## Consequences

Renames need no source-document rewrites, multiple mentions preserve separate
contexts, stale saves cannot partially alter the link index, and deleted targets
remain visibly broken rather than silently disappearing. Reads perform bounded
target resolution, and migrations must backfill the durable key before relaxing
the live foreign key.
