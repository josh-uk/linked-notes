# Security and privacy audit

This record describes the Phase 6 baseline audited on 19 July 2026. Linked Notes
is intentionally unauthenticated local software; loopback-only publication is a
security boundary, not a substitute for authentication on a LAN or the internet.

## Browser and runtime controls

- Production pages receive a per-request nonce and a restrictive CSP: default,
  object, frame, and base sources are denied; scripts and styles are nonce-bound;
  network connections are same-origin; images are limited to same-origin,
  `data:`, and `blob:`. Inline style attributes remain allowed because Tiptap
  positions editor UI dynamically, while inline scripts and eval remain denied
  in production.
- `nosniff`, frame denial, no-referrer, restrictive permissions policy,
  same-origin opener/resource policy, and origin-agent clustering are applied to
  every route. Attachment responses add their own download/preview policy.
- Startup instrumentation verifies environment parsing, attachment-directory
  writability, and data/backup schema metadata before the server becomes ready.
  The production container reported `startup_check_passed` with only runtime,
  byte limit, and schema-version fields.
- The runner uses an unprivileged UID, read-only root filesystem, bounded tmpfs,
  loopback publishing, and no global npm/npx tooling. The migration stage retains
  npm separately.
- A client error boundary offers retry/reload recovery and logs only the error
  class. Route fallbacks return stable messages and never expose unknown error
  messages or stacks.

## Security regression matrix

| Case                          | Enforced behavior                                                                                                                                                | Evidence                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Stored XSS and hostile markup | Strict editor schema, escaped pure renderer, `sanitize-html`, React text insertion, CSP                                                                          | Unit derivation tests and production browser stored-markup test                              |
| Unsafe URL schemes            | Only bounded root-relative, HTTP(S) without credentials, `mailto:`, and fragments are accepted                                                                   | Unit URL matrix and route-level `javascript:` rejection                                      |
| Path traversal                | Storage paths accept generated UUID names only; archive paths are canonical relative names                                                                       | Attachment unit/integration tests and traversal archive rejection before mutation            |
| Misleading active content     | Signature-derived MIME; SVG/HTML-like bytes fall back to attachment-only octet stream                                                                            | Real-PostgreSQL misleading upload test                                                       |
| Archive abuse                 | Compressed/expanded bytes, entry count, file size, ratio, type, duplicate, checksum, and relation limits are validated before mutation                           | Corrupt, oversized, incomplete, entry-flood, traversal, and expansion-bomb integration cases |
| PDF renderer SSRF             | JavaScript/service workers disabled, host resolution denied, and every non-`data:`/`blob:` request aborted                                                       | `npm run test:security` injects a loopback image and requires `PDF_NETWORK_REQUEST_BLOCKED`  |
| Destructive actions           | Permanent deletion requires Trash plus optimistic version and explicit safe-first dialog; replace restore requires literal `REPLACE` and creates a safety backup | Integration guards and desktop browser journeys                                              |
| Resource exhaustion           | Editor depth/node/text limits, bounded route inputs, streamed attachments, PDF image cap, archive limits, and paginated lists/search/backlinks                   | Unit/integration cases, 10k profile, and 96 MiB memory profile                               |

## Logging review

Normal server logs were searched and inspected. Application events are limited
to `startup_check_*`, `notes_api_error`, `attachment_reconciliation`, opaque
attachment cleanup state, restore/validation cleanup state, and PDF renderer
state. They contain counts, schema versions, opaque generated storage names, or
error class names. They do not contain note titles/bodies, editor JSON, search
terms, attachment bytes or original filenames, archive contents, database URLs,
secrets, stack traces, or unknown exception messages. A unit test injects a
private sentinel into an unknown route error and proves it appears in neither
the response nor logged arguments.

Client-visible domain errors remain deliberately actionable. Unknown errors are
mapped to generic fallbacks, and the fatal render boundary logs only
`error.name`.

## Automated scanning policy

- `npm audit --audit-level=high` is required and reported zero vulnerabilities
  in the audited lockfile.
- Gitleaks scans full repository history on pull requests, `master`, schedules,
  and manual runs.
- Trivy builds the exact runner target, scans OS and library packages, ignores
  findings without an available fix, fails on fixed high/critical findings, and
  retains a JSON report for 14 days.
- CodeQL scans JavaScript/TypeScript and retains SARIF for 14 days. Dependabot
  covers npm, Actions, and Docker pins.

Scanner actions are pinned to immutable commits. Scan results and artifact links
are recorded on the phase issue after the pull request gates pass; scanner noise
is not silently allow-listed.

## Remaining limits

An administrator, a process with Docker/filesystem access, or anyone who can
reach an intentionally exposed application port can read or alter the workspace.
Docker image provenance and signed release publication are Phase 7 delivery
controls. Browser CSP cannot protect a host already compromised outside the
container boundary.
