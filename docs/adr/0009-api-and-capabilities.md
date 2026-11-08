# 9. API and capabilities

Status: accepted (2026-11-08), amended (2026-11-08)

## Context

The SPA, the CLI and integrations consume one surface. v4 retrofitted capability gating onto routes the core did not serve yet.

## Decision

**Shape.** REST with JSON under `/api/v1`, described by one OpenAPI document generated from the Rust types and served at `/openapi.json`. The SPA client and its TypeScript types are generated from it. `v1` changes only additively; a break is `v2` beside `v1`. API version, core version and profile schema are three separate numbers.

**Capabilities.** `GET /api/v1/capabilities` returns the core version, the schema range, transports, bindings, step kinds, enabled features and per-device capabilities derived from roles. It comes from the same table the WASM exposes. The SPA renders from it and never branches on a brand or profile name.

**Settings.** `PUT /api/v1/devices/{id}/settings/{key}` returns the outcome and the failing step (ADR 7).

**Transport.** Plain HTTP. TLS is a documented reverse-proxy job.

**Auth.** The first run sets the admin password; there is no registration. Passwords use bcrypt at cost 12, as v4 did. A password longer than bcrypt's 72-byte limit is refused, never silently truncated. The SPA uses an httpOnly cookie session; integrations use bearer tokens scoped `read` or `admin`. The admin creates viewer accounts, each with a name and password. A viewer or `read` token reads live values and history. Configuration, the state of secrets, the write log and every write need admin. Under Home Assistant ingress the core trusts HA's login: a request from the Supervisor's ingress address that carries the ingress header acts as admin. This trust is switched on only in the add-on image; any other source on the same port still needs the core's login.

**Live.** SSE at `/api/v1/live`: a full snapshot on connect, then deltas only, no replay. One JSON object per tick, serialised once and shared by all clients. Live reads memory, never SQLite.

**History.** By device, role and range. The server picks the rollup tier so a series has at most 1,500 points (about one per pixel of a wide chart), returns time-weighted means and names the tier. Raw intervals only for short ranges.

**Errors.** `application/problem+json` (RFC 9457) with a stable machine `code`, such as `write.range` or `device.unreachable`, and no localised text. A device fault and a caller mistake have different codes and status classes.

## Considered options

- **GraphQL.** Rejected: one fixed client, and a generated REST client is cheaper.
- **WebSocket for live.** Rejected as the default: SSE is one-way, simpler and lighter; settings go through POST and PUT.
- **Client polling.** Rejected: it multiplies load for every viewer.

## Consequences

The OpenAPI document is a contract tested in the gate: a route absent from it fails.
