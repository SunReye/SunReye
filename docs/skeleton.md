# Walking skeleton

The first milestone: one register read travels to one SPA screen on the real core, packaged. Each step ends on its done-criterion and is built test-first. No step writes a register; the live inverter is only read.

1. **Gate.** One command runs `cargo test`, `bun test`, the WASM build, lint and format; AGENTS.md points to it. Done: a deliberately failing test turns it red.
2. **Profile crate.** One Deye profile converted to the new schema loads. The decoder is ported from v4 with its tests; the read plan is tested against v4's TypeScript planner cases as oracle. Done: oracle cases pass natively and in the WASM build.
3. **Transport.** The Modbus TCP client is ported from v4; the `sim` transport replays captures. Done: v4's transport corpus (`fixtures/oracle/transport.ndjson`) replays green.
4. **Endpoint task and bus.** Poll groups, backoff and the last good value with its age. Done: a `sim`-driven test shows one poll cycle publishing typed readings.
5. **Storage.** Change points, the hot table, hourly blocks, hourly rollups on UTC hours and daily rollups on plant-local days. v4's change-encoder cases, adapted to change points, are the oracle. Done: tests cover DST days, gaps, counter resets, a crash mid-bucket and a backwards clock step.
6. **API.** Capabilities, SSE live and one history route, with the generated OpenAPI document. Done: route tests, including refusal without a session.
7. **SPA.** One screen with live power and a day chart: hash router, relative paths, embedded in the binary. Done: a component test passes and the built binary serves the screen.
8. **Real device, gateway.** The owner's plant over Modbus TCP, unit 0, read only. Done: an hour of readings stored and shown, matching the values v4 reports for the same hour.
9. **Real device, Solarman.** The ported V5 framing with its quirk tests, on the stick at unit 1. Done: the same values as through the gateway.
10. **Solar forecast.** The owner's layout: MPPT input 1 with 2 × 16 modules in parallel, south and north; MPPT input 2 with 14 modules south. The weather fake in tests, Open-Meteo live; Perez fixtures from pvlib. Done: the day chart shows the forecast per string and the live estimates of the two parallel strings, which sum to the measured MPPT power.
11. **Package.** The Docker image, and the SPA under a real Home Assistant ingress prefix. Done: the image runs the skeleton; the ingress result is recorded in ADR 13.
