# Security policy

Linked Notes is local-only and has no authentication boundary. Do not expose its listening port outside a trusted host.

Please report vulnerabilities privately through GitHub's private vulnerability reporting for this repository. Do not place exploit details or private data in a public issue. Include the affected version, reproduction steps using synthetic data, impact, and any suggested mitigation.

Only the latest stable `1.x` release receives security fixes until a broader
support policy is published. Dependency, full-history secret-pattern, static,
container, SBOM, provenance, PDF-network-denial, and release-image checks run in
repository automation; a passing scanner is not a substitute for review.

Release images are private GHCR packages. Verify the exact digest and attached
`SHA256SUMS`/SBOM evidence before deployment. Where the account supports GitHub
artifact attestations, verify the signed provenance as described in
`docs/releases.md`; registry-native BuildKit provenance remains present when the
optional GitHub attestation service is unavailable.
