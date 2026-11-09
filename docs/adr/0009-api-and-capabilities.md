# 9. API and capabilities

Status: accepted (2026-11-08), amended (2026-11-09)

## Context

The SPA, the CLI and integrations consume one surface. v4 retrofitted capability gating onto routes the core did not serve yet.

## Decision

**Shape.** REST with JSON under `/api/v1`, described by one OpenAPI document generated from the Rust types and served at `/openapi.json`. Each route registers together with its description (`utoipa-axum`). The SPA client and its TypeScript types are generated from it. `v1` changes only additively; a break is `v2` beside `v1`. API version, core version and profile schema are three separate numbers.

**Capabilities.** `GET /api/v1/capabilities` returns the core version, the schema range, transports, bindings, step kinds, enabled features and per-device capabilities derived from roles. It comes from the same table the WASM exposes. The SPA renders from it and never branches on a brand or profile name.

**Settings.** `PUT /api/v1/devices/{id}/settings/{key}` returns the outcome and the failing step (ADR 7).

**Transport.** Plain HTTP. TLS is a documented reverse-proxy job.

**Auth.** The first run sets the admin password; there is no registration. Passwords use bcrypt at cost 12, as v4 did. A password longer than bcrypt's 72-byte limit is refused, never silently truncated. The SPA uses a cookie session: `HttpOnly`, `SameSite=Strict`, `Secure` when the request arrived over TLS (the proxy's `X-Forwarded-Proto: https`), expiring 30 days after its last use. Sessions live in memory, at most 64: a restart signs everyone out, and using a session writes nothing to flash. Failed logins back off exponentially per client address: 1 s after the first failure, doubling to 15 min, answered `429` with `Retry-After`; an attempt counts as failed until it succeeds, so concurrent guesses wait too. Integrations use bearer tokens scoped `read` or `admin`. The admin creates viewer accounts, each with a name and password. A viewer or `read` token reads live values and history. Configuration, the state of secrets, the write log and every write need admin. Under Home Assistant ingress the core trusts HA's login: a request from the Supervisor's ingress address (`172.30.32.2`) that carries the ingress header `X-Ingress-Path` acts as admin, even before the first run sets a password. This trust is switched on only in the add-on image, through `--ingress` (ADR 2); any other source on the same port, or the Supervisor without the header, still needs the core's login.

**Live.** SSE at `/api/v1/live`: a full `snapshot` event on connect, then `delta` events only, no replay; a client that falls behind is disconnected and reconnects to a snapshot. One JSON object per tick, serialised once and shared by all clients. A tick is a 1 s window that coalesces every reading changed in it, whatever the poll cadences; a tick with no change sends nothing. Live reads memory, never SQLite.

**History.** `GET /api/v1/devices/{id}/history` by `series` (ADR 3, such as `pv.mppt.power[2]`) and the range `from` to before `to`, RFC 3339 instants. The server picks the tier so a series has at most 1,500 points (about one per pixel of a wide chart), returns time-weighted means and names the tier. A range of up to a day returns `raw` intervals while it holds at most 1,500 of them, else `bucket`: means over UTC-aligned buckets computed on read from change points, with their `width` in seconds, 60 s (a day is at most 1,441 of them); nothing is stored for buckets. Longer ranges return `hour` rollups up to 1,499 hours, the hour in progress read from change points, else `day` rollups up to 1,498 days of 23 hours. Each point is an interval, bucket or rollup with its own start and end, so the first may begin before `from`; a gap is not part of a mean, and a point has at least some value. History ends at the core's clock: the last value is not held into the future. A longer or empty range is refused as `history.range`. A counter's `raw` and `bucket` points are its readings and their time-weighted mean; past them it is refused as `history.counter`, as its rollups hold a delta, not a mean.

**Forecasts.** `GET /api/v1/devices/{id}/forecasts` by series and range, with the same 1,500-point cap. It returns the latest issue by default; `issuedBefore` selects an earlier one, so forecast accuracy can be compared (ADR 15).

**Problems.** `GET /api/v1/problems` lists the conditions degrading the core by stable code, such as `clock.unsynced` (ADR 3).

**Errors.** `application/problem+json` (RFC 9457) with a stable machine `code`, such as `write.range` or `device.unreachable`, and no localised text. A device fault and a caller mistake have different codes and status classes. Error and problem codes are one closed set, listed as the `Code` enum of the OpenAPI document, so the SPA's text for each is checked against it (ADR 11).

## Considered options

- **GraphQL.** Rejected: one fixed client, and a generated REST client is cheaper.
- **WebSocket for live.** Rejected as the default: SSE is one-way, simpler and lighter; settings go through POST and PUT.
- **Client polling.** Rejected: it multiplies load for every viewer.

## Consequences

The OpenAPI document is a contract tested in the gate: every API test request checks that the route it reached is in the served document, so a route absent from it fails. The served document is committed at `crates/core/openapi.json` and the SPA's types are generated from that file; the gate fails when either is stale, and `bun run --cwd apps/web api` regenerates both.
