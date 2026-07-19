# Performance measurements

These measurements are a reproducible local regression profile, not a promise
for every host. They were recorded on 19 July 2026 on macOS 26.4.1 arm64 with
Node.js 24.16.0, npm 11.13.0, Docker Engine 29.6.1 (Linux arm64), PostgreSQL
18.4 (Alpine), and a warm database cache. PostgreSQL ran in Docker Desktop; the
measurement process ran on the host against an isolated
`linked_notes_performance` database.

## Representative dataset and budgets

`scripts/measure-search.ts` deterministically creates RFC-valid UUIDs and
refuses to replace data unless the database name ends in `_performance`.

- 10,000 notes with versioned JSON, derived HTML, and plain-text bodies
- 20 folders and 30 tags
- 10,000 note/tag associations
- 10,000 durable note links, including 1,000 inbound links to one target
- 1,000 attachment metadata rows
- 300 matching notes before lifecycle filtering: 100 title matches and 200
  body-only matches

The regression budgets are p95 below 50 ms for each database-backed interactive
query, below 150 ms for server derivation and transactional reconciliation of an
extreme 1,000-mention document, and less than 32 MiB additional app-container
memory while streaming a 96 MiB attachment. These are local engineering gates,
not user-facing service-level guarantees.

## Measured results

The dataset seeded in 758.70 ms. Twenty-five warm samples were collected for
interactive queries and eight for the extreme editor/link workload.

| Operation                                                                  |   Median |      p95 |  Maximum | Budget |
| -------------------------------------------------------------------------- | -------: | -------: | -------: | -----: |
| Weighted title/body search, lifecycle filter, title-first rank, limit 40   |  3.69 ms |  6.89 ms |  7.41 ms |  50 ms |
| Active-note first page, keyset order, limit 40                             |  1.69 ms |  2.00 ms |  7.42 ms |  50 ms |
| Active-note page after the 5,000th-row cursor, limit 40                    |  1.61 ms |  2.43 ms |  2.44 ms |  50 ms |
| Backlink page from 1,000 inbound links, limit 51                           |  2.16 ms |  3.36 ms |  4.77 ms |  50 ms |
| Mention suggestions, prefix-first, limit 10                                |  4.22 ms |  4.35 ms |  4.91 ms |  50 ms |
| Validate, derive text, render and sanitize 1,000 mentions                  | 35.29 ms | 91.39 ms | 91.39 ms | 150 ms |
| Delete/create-many link reconciliation plus note update for 1,000 mentions | 62.45 ms | 64.45 ms | 64.45 ms | 150 ms |

Autosave is debounced and sent asynchronously, so editor keystrokes do not run
document derivation, search indexing, or link reconciliation on the browser main
thread. The 1,000-mention measurements deliberately exceed an ordinary note and
bound the server work behind one save.

The 96 MiB upload used 64 KiB client chunks and completed in 4,101.97 ms at
23.40 MiB/s. App-container memory rose from 122.30 MiB to 140.60 MiB, an
18.30 MiB increase, across three Docker-stat samples. The server SHA-256 matched
`49542702b710c0b50cd7bc83caee0e8e0fe03c8863a052b52d3f30f9101350ad`.
The temporary attachment and note were removed after verification.

## Query-plan review

`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` recorded:

- Search used `Note_content_search_idx` through a bitmap index scan, then an
  exact bitmap heap scan and in-memory top-N heapsort. It returned 40 of 282
  visible matches in 5.252 ms with 566 shared-buffer hits, no reads, no lossy
  blocks, and no temporary I/O.
- The first active-note page used a sequential scan of 10,000 rows and an
  in-memory top-N heapsort, completing in 1.631 ms with 485 shared-buffer hits
  and no reads or temporary I/O. PostgreSQL correctly costed the compact warm
  table scan below the available composite index at this size; deep keyset pages
  still remained below 2.5 ms p95.
- Backlinks used
  `NoteLink_targetKey_updatedAt_sourceNoteId_mentionId_idx` directly, returning
  51 rows in 0.037 ms with 51 shared-buffer hits, no reads, and no temporary I/O.

Interactive note lists and backlinks use opaque keyset cursors. Search uses a
bounded offset because ranking can reorder matches; input limits cap its page
size and offset. The PDF backlink option also uses a 100-mention keyset page and
prints a truncation notice when more mentions exist.

## Remaining limits

- The profile is synthetic, single-user, warm-cache, and local. Cold storage,
  concurrent writers, virtualization pressure, and collections above 10,000
  notes require separate measurement.
- Search ranking still evaluates and sorts every matching row before applying
  the limit. Very common terms or substantially larger collections may require a
  materialized search vector or a different ranking strategy.
- PostgreSQL preferred a sequential scan for the first 10,000-row active list.
  This is fast at the measured scale but must be revisited at 100,000 notes and
  under cold-cache conditions.
- A 1,000-mention save is below the local budget but is still visible server
  work. The client keeps it off the input path; deployments on slower hardware
  should remeasure before raising document limits.
- PDF image embedding remains bounded by `MAX_PDF_IMAGE_BYTES`; backlink output
  is deliberately capped per export rather than promising an unbounded PDF.
