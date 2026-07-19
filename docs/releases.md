# Releases

Linked Notes uses Semantic Versioning and Keep a Changelog. Release automation is completed in Phase 7.

A release pull request updates the package version, changelog, documentation, upgrade path, migration notes, and recovery notes. After full CI passes and the pull request is merged to `master`, a `vX.Y.Z` tag on that exact commit triggers image publication and the GitHub Release. Release images use immutable full-version tags, supported moving major/minor tags, and `latest` only for stable releases.

Before upgrading, create coordinated PostgreSQL and attachment-volume backups. Migrations are forward operations and are not hidden behind app restart loops. Rollback means restoring the pre-upgrade database and attachment volumes with the prior image, unless the release notes explicitly document a compatible image-only rollback.
