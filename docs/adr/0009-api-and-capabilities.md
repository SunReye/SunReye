# 9. API and capabilities

Status: proposed (2026-11-08)

## Context

The SPA, the CLI and integrations consume one surface. v4 retrofitted capability gating onto routes the core did not serve yet.

## Decision

**Shape.** REST with JSON under `/api/v1`, described by one OpenAPI document generated from the Rust types and served at `/openapi.json`. The SPA client and its TypeScript types are generated from it. `v1` changes only additively; a break is `v2` beside `v1`. API version, core version and profile schema are three separate numbers.

**Capabilities.** `GET /api/v1/capabilities` returns the core version, the schema range, transports, bindings, step kinds, enabled features and per-device capabilities derived from roles. It comes from the same table the WASM exposes. The SPA renders from it and never branches on a brand or profile name.

**Settings.** `PUT /api/v1/devices/{id}/settings/{key}` returns the outcome and the failing step (ADR 7).

**Auth.** The first run sets the admin password; there is no registration. A memory-hard hash (Argon2id, parameters tuned on the target hardware). The SPA uses an httpOnly cookie session; integrations use bearer tokens scoped `read` or `admin`. A viewer or `read` token reads live values and history. Configuration, the state of secrets, the write log and every write need admin.

**Live.** SSE at `/api/v1/live`: a full snapshot on connect, then deltas only, no replay. One JSON object per tick, serialised once and shared by all clients. Live reads memory, never SQLite.

**History.** By device, role and range. The server picks the rollup tier so the number of points is bounded (the cap comes from the skeleton), returns time-weighted means and names the tier. Raw intervals only for short ranges.

**Errors.** `application/problem+json` (RFC 9457) with a stable machine `code`, such as `write.range` or `device.unreachable`, and no localised text. A device fault and a caller mistake have different codes and status classes.

## Considered options

- **GraphQL.** Rejected: one fixed client, and a generated REST client is cheaper.
- **WebSocket for live.** Rejected as the default: SSE is one-way, simpler and lighter; settings go through POST and PUT.
- **Client polling.** Rejected: it multiplies load for every viewer.

## Consequences

The OpenAPI document is a contract tested in the gate: a route absent from it fails.
