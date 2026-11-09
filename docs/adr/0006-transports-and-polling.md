# 6. Transports and polling

Status: accepted (2026-11-08), amended (2026-11-09)

## Context

A request handler must never touch a device. Endpoints are fragile: a Solarman stick has no spare client slot and answers a transient `05` under overlap, Fronius Gen24 allows two parallel queries, SolarEdge one connection, SMA four.

## Decision

- **Transports:** Modbus TCP, RTU over TCP, Solarman V5 and `sim`. `sim` replays a capture recorded from a real device by the core's `sunreye capture` subcommand, which reuses these transports. The TypeScript CLI calls it; no transport is written in TypeScript. It is a first-class transport used by the skeleton, the tests and SPA development, and replaces an environment switch. Serial RTU is not in the first release: gateways cover it, and Eastron meters on RS485 need one. HTTP and MQTT are bindings with their own clients (ADR 10).
- **Captures.** `sunreye capture --endpoint <transport>://<host>:<port> --unit <id> --profile <id>` polls one device with a bundled profile's read plan for twelve cycles at the cadence and prints the capture to stdout. The capture wire refuses every request but function 3 before a byte reaches the device, whatever the caller asks: a capture cannot write. The file is a published contract between the core, the CLI and the fixtures, as NDJSON: a header line `{"capture":1,"profile","version","framing","unit"}`, then one line per exchange in order, `{"tx":"<hex>"}` for bytes sent or `{"rx":["<hex>",…]}` for a reply, one chunk per read. `sim` matches each request byte for byte, so a capture replays only with the read plan that recorded it: the header names the profile version. A reader refuses a `capture` format it does not know; a later format adds a number.
- **One task per endpoint,** owned by the core. An endpoint is a request/response address with its transport (Modbus TCP, RTU over TCP, Solarman). Its task serialises every read and write to that address for every device behind it, honours the profile's and endpoint's limits (parallel requests, minimum interval, timeout floor), and backs off on error. An `http` or `mqtt` connection has its own task and is not serialised: a broker client holds subscriptions, and an HTTP device may answer parallel requests. At each connect it walks the SunSpec chain of every device whose profile reads SunSpec models and binds the profile to it (ADR 5); a device with no chain reads nothing until the next connect. A task publishes the last good value with its age.
- **Setup scan.** First run scans the local network for known endpoints (Modbus ports 502, 1502 and 6607, Solarman loggers on their port 8899), runs the identify probes (ADR 5) to propose a profile and unit id, and asks the homeowner to confirm. Manual entry is the fallback: an endpoint that answers no probe is listed bare. The scan is read only and bounded so it cannot flood the LAN. Its wire is the capture's, which refuses every request but function 3. It covers a private subnet of at most a /24, by default the /24 of the core's address. At most 32 connects run at once at 0.5 s each, and at most 8 endpoints are identified at once, each one request at a time at 1.5 s. One scan runs at a time. An endpoint already configured is left to its task. Until profiles declare a magic register, a profile's identify probe reads one word of its first planned register at unit ids 1, 0 and 2 to 5, and every unit that answers is proposed. The built-in SunSpec probe (ADR 5) runs after them at the same unit ids, and proposes each unit whose chain walks, with its variant.
- **Poll groups** and cadence come from the profile, per group.
- **The unit id belongs to the device** as its device address behind the endpoint: a gateway serves several unit ids on one endpoint. A connection is the endpoint, broker or HTTP host plus its credentials. On the dev plant the same inverter answers unit 0 through a gateway and unit 1 through a Solarman stick, and 0 stays valid. Scan probes the first planned register. Devices with dynamic unit ids (Victron, SMA) are found by scan.
- **Configuration.** The devices module owns connections, their secrets and devices. A device has a stable integer id, never reused, that keys its history; it names its connection, its profile by id and its unit id. Its profile is fixed once added, as its history is stored in that profile's steps (ADR 3). Two devices on one endpoint never share a unit id, whichever connection each names. A change applies at once: a task whose devices changed stops before its replacement connects, and a device's series are declared to storage before it is polled. Until profile distribution (ADR 8) lands, the profiles are the official ones bundled at build time.
- **One bus of typed readings:** series (role and index), value, unit, timestamp, device. A reading is fixed-size and copyable, with series ids interned. Storage, the live API, integrations and write read-back subscribe. No consumer decodes registers.
- **Live values** reach the SPA from memory over SSE (ADR 9). SQLite is not on that path.

## Considered options

- **A capture of decoded register values.** Rejected: `sim` would not check the framing, the transaction ids or the Solarman envelope a real device sees.

- **Concurrent requests per endpoint.** Rejected: interleaving breaks single-slot sticks, and the speed-up is worth nothing next to the 50 to 200 ms a device takes per request.
- **A task per device.** Rejected: devices behind one gateway share its limits.
- **A task per connection, unit id on the connection.** Rejected: two connections to one Solarman stick would interleave on its single slot.

## Consequences

Real time is bought with fewer requests (the read plan, ADR 5), not with parallelism. A slow endpoint delays only its own devices.
