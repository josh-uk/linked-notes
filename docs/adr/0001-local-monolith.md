# ADR 0001: Local containerised monolith

- Status: accepted
- Date: 2026-07-19

## Decision

Use one Next.js App Router repository and standalone application container, one PostgreSQL container, and named volumes for database and attachment persistence. Docker Compose is the supported installation surface and binds the app to loopback by default.

## Consequences

The runtime is understandable, can operate without internet access, and keeps transaction logic close to server routes. Users must operate Docker and back up two coordinated volumes. The absence of authentication is safe only while the listener remains locally scoped.
