# Performance measurements

Performance evidence is a reproducible local regression profile, not a promise
for every host. Phase 3 was measured on 19 July 2026 using an arm64 Docker Desktop
host, Docker Engine 29.6.1, PostgreSQL 18.4 (aarch64 Alpine), a warm database
cache, and the production search SQL shape.

## Representative dataset

- 10,000 notes with versioned JSON, derived HTML, and plain-text bodies
- 20 folders and 30 tags
- 10,000 note/tag associations
- 10,000 durable note links
- 1,000 attachment metadata rows
- 300 matching notes before lifecycle filtering: 100 title matches and 200
  body-only matches

The committed `scripts/measure-search.ts` fixture uses deterministic UUIDs and
data. It refuses to replace data unless the database name ends in
`_performance`.

## Results

Twenty-five warm samples were recorded after `ANALYZE`:

| Operation                                                                      |  Median |     p95 | Maximum |
| ------------------------------------------------------------------------------ | ------: | ------: | ------: |
| Weighted title/body search, lifecycle filtering, title-first ranking, limit 40 | 3.61 ms | 3.98 ms | 6.68 ms |
| Active-note list ordered by update time, limit 40                              | 2.17 ms | 2.37 ms | 5.17 ms |

Seeding the complete dataset took 611.98 ms. `EXPLAIN (ANALYZE, BUFFERS)`
reported 3.402 ms execution time for the measured search. Its plan used a
`Bitmap Index Scan` on `Note_content_search_idx`, followed by a bitmap heap scan
and an in-memory top-N heapsort; there were no lossy blocks, disk reads, or
temporary writes in the warm run.

## Interpretation and limits

The GIN expression exactly matches the weighted vector in the query and avoids a
sequential scan for the representative term. Ranking still evaluates and sorts
all matches before returning 40 results, so very common terms and substantially
larger collections need renewed measurement. Offset pagination is bounded but
cost grows for deep pages; cursor pagination remains in use for non-search lists.
Phase 6 will repeat profiling at larger scales and review remaining query/index
trade-offs.
