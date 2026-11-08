# 5. Device profile format

Status: proposed (2026-11-08)

## Context

v4 kept two decoders (a TypeScript codec and a Rust one), a strict zod schema beside a lenient Rust loader, and generated types in one direction only. Every profile bug had two places to hide. The German market is not one vendor: the evidence is in `docs/research/german-inverter-landscape.md` (SMA, Fronius, SolarEdge, Kostal, Huawei, Sungrow, GoodWe, SolaX, Victron, E3/DC, Deye, Enphase, Shelly).

## Decision

**One owner.** A Rust crate owns the format: loader, decoder, validation, lints, capability table and schema rules. The core and a WASM build compile from that source. The npm package ships the WASM and TypeScript types generated from the Rust types. The authoring API (`define…`) and the CLI are thin TypeScript over it, with autocomplete from the generated types. No second decoder exists.

**Schema versions.** A profile declares one integer `schema`. The core and the WASM report the supported range and a capability list (bindings, decoders, step kinds).

- The current and previous schema load. The previous one yields deprecation warnings that name the replacement and the removal version.
- A removed schema is refused with an error naming the migration. Removal happens only in a major release. `migrate` rewrites an old profile.
- Warnings are data from the WASM, so the CLI, the core log and the SPA show identical text.

**Admission rule.** A format feature is admitted only when at least two vendors need it or the owner's own device does. The evidence table below is the record; a feature that fails waits.

**Bindings.** `modbus` (TCP, RTU over TCP, Solarman V5, with SunSpec built in), `http` (JSON paths, with auth kinds admitted per vendor) and `mqtt`. UDP, WebSocket and SML have one verified vendor each and wait.

**Read side.**

- Per point: register space (holding or input), an address base per profile, type (int and uint 16/32/64, float 32/64, string, bitfield, enum with arbitrary values, a register split into bytes), word order fixed per group or read from a register, a static scale or a scale factor read from a register, sentinels by type. A float point declares its stored resolution; a lint requires it.
- SunSpec is a built-in binding: find the base (40001, then 50001, then 1), check `SunS`, walk the model chain to `0xFFFF`, read scale factors with their values, treat sentinels as absent, map standard models to roles. One generic SunSpec profile covers conforming devices; vendor profiles add only what SunSpec lacks.
- Variants by device type, chosen by an identify probe (a magic register: `SunS`, `0xE3DC`, or a device-type register).
- The unit id belongs to the connection (ADR 6), not the profile.
- Storage class (`series`, `config`, `none`) and a deadband per role (ADR 3, 4).

**Read plan.** Compiled once at load, or at connect for SunSpec. Contiguous registers coalesce into blocks of at most 120. A framing-specific gap tolerance merges blocks when a round trip costs more than the wasted registers: `tcp` 0, `rtu-over-tcp` 0, `solarman-v5` 32 (measured on one stick in v4: about 199 ms per read busy, 2 ms per register). The inputs of a computed role are read in one transaction for a single device snapshot. A merged block refused with Modbus exception 2 is split and the split remembered. A flat list of decode operations runs per poll with no allocation. The same plan serves the CLI's "decode this dump".

**Write side.** A setting is a recipe (ADR 7). Admitted step kinds: `write` (function code 6 or 16), `write-block`, `rmw` (mask), `unlock` with `finally` steps, `precondition`, `activate` (values, then an enable field last), `delay`, `snapshot-toggle` (the owner's Deye discharge lock) and `mqtt` publish. Not admitted yet: a commit register with status (SolarEdge only), function codes 5 and 23, SML, Speedwire.

**Official profiles.** A profile is official only when a capture of a real device replays in `sim` and passes its tests, and its writes were verified on real hardware.

### Evidence for admitted features

| Feature | Vendors |
| --- | --- |
| Holding vs input space, address base | Sungrow, SolaX, SunSpec vendors |
| Word order per profile or group | Deye and Sungrow (low first), GoodWe (high first), SolarEdge (control group little-endian) |
| Word order read from a register | Kostal, Eastron |
| Scale factor from a register | SunSpec (SMA, Kostal, Fronius, SolarEdge, E3/DC), Kostal setpoints |
| Sentinels by type | SunSpec vendors, Sungrow, SMA |
| Packed bytes, bitfields | E3/DC, SolaX, Deye, GoodWe, Huawei |
| Float32 | Eastron, GoodWe, SunSpec 11x |
| Identify probe | SunSpec, E3/DC |
| `unlock` | SMA (Grid Guard), SolaX, Eastron |
| `rmw` | Deye, GoodWe, Huawei |
| Table settings (period records) | Huawei, GoodWe, Deye |
| `precondition` | Kostal, SMA, SolarEdge, Fronius |
| `activate` | SunSpec 123 and 124 (Fronius, SMA, E3/DC), SolarEdge |
| Atomic block write, ordered sequence | SolaX, Sungrow, GoodWe |
| Minimum request interval | Sungrow, SolaX |
| HTTP with auth | Fronius, Enphase, Shelly, sonnen |

## Considered options

- **TypeScript owns the format, Rust loads it (v4).** Rejected: two decoders drift.
- **A shipped Rust binary as the SDK.** Rejected: autocomplete and editor types come for free from TypeScript, and a WASM module loads in-process.
- **The core embeds a WASM runtime.** Rejected: the core is native; WASM is only for the CLI.

## Consequences

The WASM glue crate is the one `unsafe` exception (ADR 2). A schema bump forces a core update, bounded by the previous-schema rule. Vendors this ADR could not verify (Growatt, Varta, Senec, sonnen's local API, FOX ESS, Anker, Marstek, Fenecon) are not supported until a primary document or a capture exists.
