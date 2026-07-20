# Releases and upgrades

Linked Notes uses Semantic Versioning, Keep a Changelog, immutable source
commits, and two matching container images:

- `ghcr.io/josh-uk/linked-notes` is the unprivileged application runner.
- `ghcr.io/josh-uk/linked-notes-migrate` contains Prisma migration tooling and
  exits after `prisma migrate deploy`.

The repository and packages are private. A user must have access to
`josh-uk/linked-notes` and authenticate Docker to `ghcr.io` before pulling them.
Source builds remain the no-registry alternative.

## Published tag contract

Every successful `master` security run triggers full validation, amd64 and
arm64 release-image smoke tests, then publishes both images under the immutable
`master-<short-sha>` tag. A superseded commit is skipped rather than published.

A validated stable `vX.Y.Z` tag on the current `master` commit reruns the full
suite and both architecture smokes, then publishes matching `X.Y.Z`, `X.Y`, `X`,
and `latest` tags. BuildKit publishes maximum-mode provenance and SPDX SBOM
attestations in GHCR. The workflow also attempts GitHub-signed provenance and
SBOM attestations; plan-level unavailability is recorded without discarding the
registry-native evidence. The GitHub Release contains generated notes, two SPDX
JSON files, exact image digests, attestation status, available signed bundles,
and `SHA256SUMS`.

Moving tags are conveniences. Pin `X.Y.Z` for a release line or the digest from
`release-image-digests.json` when reproducibility matters.

## User upgrade procedure

1. Download a fresh portable backup from **Workspace Settings → Portable
   backup** and copy it off the Docker host. Run **Check attachment storage**.
2. Record the current app/migration image tags and the release digest. Do not
   remove either named volume.
3. Read the target changelog entry and migration/rollback notes.
4. Put matching image values in `.env`, for example:

   ```dotenv
   APP_IMAGE=ghcr.io/josh-uk/linked-notes:1.0.0
   MIGRATE_IMAGE=ghcr.io/josh-uk/linked-notes-migrate:1.0.0
   ```

5. Authenticate, pull, and start. Compose runs the one-shot migration before it
   replaces the app:

   ```bash
   docker login ghcr.io
   docker compose pull app migrate
   docker compose up -d
   docker compose ps
   ```

6. Open the loopback URL, inspect representative notes and attachments, create a
   PDF, run a fresh backup, restart the app with `docker compose restart app`,
   and confirm the data remains.

The first supported public release is `1.0.0`; there is no promised upgrade path
from an external `0.x` release. CI still proves the earliest repository schema
upgrades through every committed migration while preserving notes and durable
links.

## Rollback and recovery

Database migrations are forward operations. Do not point an older app image at
a database migrated by a newer release unless that release explicitly says it
is compatible. The safe rollback is coordinated recovery:

1. Stop the app without deleting volumes: `docker compose stop app`.
2. Restore the pre-upgrade portable backup through the target release when it
   remains schema-compatible, or restore the coordinated pre-upgrade PostgreSQL
   and attachment-volume snapshot.
3. Restore both prior image tags in `.env` and start Compose.
4. Verify health, representative content, attachment checksums, PDF output, and
   a new portable backup.

See [operations](operations.md), [backup and recovery](backup-format.md), and
[troubleshooting](troubleshooting.md). Never use `docker compose down --volumes`
as an upgrade or rollback command.

## Maintainer release procedure

1. Start a release issue/branch from current `master`. Update `package.json` and
   its lockfile, move the changelog into a dated version entry, and update
   upgrade, migration, recovery, security, and release docs in one release PR.
2. Run the documented quality, integration, migration, browser, Compose, and
   release-image checks. The release-image proof must pass for local/native
   architecture; GitHub proves amd64 and arm64 on matching native hosted
   runners.
3. Merge only after every required PR check passes. Wait for the `Security` and
   `Post-merge image` workflows on the merge commit, and record the immutable
   `master-<short-sha>` app/migration digests.
4. Confirm local `master` exactly matches the remote, then create and push an
   annotated stable tag:

   ```bash
   git switch master
   git pull --ff-only origin master
   git tag -a v1.0.0 -m "Linked Notes 1.0.0"
   git push origin v1.0.0
   ```

5. Do not move or recreate a published release tag. Watch the `Release`
   workflow through validation, two-architecture smoke, image publication,
   attestations, and GitHub Release creation.
6. Pull the version tag by digest on a clean installation and repeat health,
   persistence, PDF, backup/restore, and outbound-disabled smoke. Record exact
   tags/digests, workflow/release URLs, SBOM/provenance status, and limitations
   on the release issue.

## Verify release evidence

```bash
docker buildx imagetools inspect ghcr.io/josh-uk/linked-notes:1.0.0
docker buildx imagetools inspect ghcr.io/josh-uk/linked-notes-migrate:1.0.0
gh release download v1.0.0 --repo josh-uk/linked-notes --dir release-evidence
(cd release-evidence && sha256sum -c SHA256SUMS)
gh attestation verify oci://ghcr.io/josh-uk/linked-notes:1.0.0 \
  --repo josh-uk/linked-notes \
  --signer-workflow josh-uk/linked-notes/.github/workflows/image-publish.yml
```

If GitHub-signed attestations are unavailable for the private account plan, the
signed-bundle verification command will report no GitHub attestation. In that
case verify the release checksums/digests, inspect the BuildKit provenance and
SPDX SBOM attestations in GHCR, and use the attached SPDX files and
`release-image-digests.json`. This limitation must be recorded in the issue and
release evidence; it must not be silently described as a signed attestation.

Action pins are immutable commit SHAs. Dependabot proposes updates; maintainers
review the upstream release and change the SHA plus readable version comment
together. Release workflows never consume code from a mutable action tag.
