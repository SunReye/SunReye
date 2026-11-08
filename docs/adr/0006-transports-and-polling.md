# 6. Transports and polling

Status: proposed (2026-11-08)

## Context

A request handler must never touch a device. Endpoints are fragile: a Solarman stick has no spare client slot and answers a transient `05` under overlap, Fronius Gen24 allows two parallel queries, SolarEdge one connection, SMA four.

## Decision

- **Transports:** Modbus TCP, RTU over TCP, Solarman V5 and `sim`. `sim` replays a capture recorded by the CLI from a real device. It is a first-class transport used by the skeleton, the tests and SPA development, and replaces an environment switch. Serial RTU is not in the first release: gateways cover it, and Eastron meters on RS485 need one. HTTP and MQTT are bindings with their own clients (ADR 10).
- **One task per endpoint,** owned by the core. It serialises every read and write to that address, honours the profile's and connection's limits (parallel requests, minimum interval, timeout floor), and backs off on error. It publishes the last good value with its age.
- **Poll groups** and cadence come from the profile, per group.
- **The unit id belongs to the connection.** On the dev plant the same inverter answers unit 0 through a gateway and unit 1 through a Solarman stick, and 0 stays valid. Scan probes the first planned register. Devices with dynamic unit ids (Victron, SMA) are found by scan.
- **One bus of typed readings:** role, value, unit, timestamp, device. A reading is fixed-size and copyable, with role ids interned. Storage, the live API, integrations and write read-back subscribe. No consumer decodes registers.
- **Live values** reach the SPA from memory over SSE (ADR 9). SQLite is not on that path.

## Considered options

- **Concurrent requests per endpoint.** Rejected: interleaving breaks single-slot sticks, and the speed-up is worth nothing next to the 50 to 200 ms a device takes per request.
- **A task per device.** Rejected: devices behind one gateway share its limits.

## Consequences

Real time is bought with fewer requests (the read plan, ADR 5), not with parallelism. A slow endpoint delays only its own devices.
