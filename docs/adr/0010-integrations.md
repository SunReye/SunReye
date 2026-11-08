# 10. Integrations

Status: accepted (2026-11-08), amended (2026-11-08)

## Context

EVCC, MQTT devices and Home Assistant are neighbours, not special cases. The EVCC contract was verified in v4 against EVCC's source and a live instance: state topics are retained, keys are camelCase, loadpoints are 1-based, writes go to `<root>/loadpoints/<n>/<key>/set`, and `batteryBoost` errors unless the mode is `pv` or `minpv`, and a mode change clears it.

## Decision

- **EVCC is an official profile** with an `mqtt` binding. Its topics map to `ev` roles; a loadpoint is a device whose device address is its loadpoint index. Mode, limit SOC and battery boost are recipes with `mqtt` publish steps: mode first, boost last, a `precondition` on mode. Read-back is the retained state EVCC republishes within about 2 s. These writes run through the funnel of ADR 7 as admin actions, with the same audit and outcomes.
- **One MQTT client per broker connection,** owned by a task, with reconnect backoff from 1 s up to 60 s and an observed status (`connected`, `lastError`, `lastConnectedAt`). EVCC, custom MQTT profiles and the publisher share it.
- **Outbound is read-only.** `GET /api/v1/roles/{role}` gives a scalar or indexed value for EVCC's HTTP custom meter. An MQTT publisher puts role values and device availability under a topic root, with optional Home Assistant discovery. Both use a scoped `read` token. Battery dispatch from EVCC is not offered (ADR 1, 7).
- **Conventions at the edge.** Roles carry one sign convention (ADR 4). Each adapter converts at its own edge and has a golden test against the consumer's documented convention.
- **Custom profiles** are community profiles with `mqtt` or `http` bindings, built with the CLI and distributed through a custom index (ADR 8). No scripting.
- **Settings.** A connection holds host, port, topic root and credentials; each loadpoint device holds its index. Both are entered in the SPA. Credentials are secrets (ADR 7). A connection is enabled by a flag; there is no separate integrations page and no mapping UI.

## Considered options

- **EVCC as code in the core.** Rejected: it would be the first non-Modbus special case and the format would never be tested against MQTT.
- **EVCC over REST.** Rejected: cookie authentication; MQTT state is retained and instant.
- **Accepting EVCC's battery dispatch.** Rejected: a control loop.

## Consequences

EVCC needs `mqtt` publish steps and `precondition` in the format on day one, which also covers the Shelly and Victron MQTT cases.
