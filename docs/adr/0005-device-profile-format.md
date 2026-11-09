# 5. Device profile format

Status: accepted (2026-11-08), amended (2026-11-09)

## Context

v4 kept two decoders (a TypeScript codec and a Rust one), a strict zod schema beside a lenient Rust loader, and generated types in one direction only. Every profile bug had two places to hide. The German market is not one vendor: the evidence is in `docs/research/german-inverter-landscape.md` (SMA, Fronius, SolarEdge, Kostal, Huawei, Sungrow, GoodWe, SolaX, Victron, E3/DC, Deye, Enphase, Shelly).

## Decision

**One owner.** A Rust crate owns the format: loader, decoder, validation, lints, capability table and schema rules. The core and a WASM build compile from that source. The npm package ships the WASM and TypeScript types generated from the Rust types. The authoring API (`define…`) and the CLI serve profile authors; a homeowner never needs them. They are thin TypeScript over it, with autocomplete from the generated types. No second decoder exists. A `profile` test renders the types from the Rust types with ts-rs and fails when the committed file differs.

**Schema versions.** A profile declares one integer `schema` and the capabilities it `requires`. The core and the WASM report the supported range and a capability list (bindings, decoders, step kinds).

- A new binding, decoder or step kind is additive: it joins the capability list without a schema bump. `schema` bumps only when an existing field changes meaning or is removed.
- A core that lacks a required capability refuses the profile with an error naming it.
- A profile that uses a capability without listing it in `requires` loads with a warning: an older core lacking it would refuse the profile without naming it.
- The current and previous schema load. The previous one yields deprecation warnings that name the replacement and the removal version.
- A removed schema is refused with an error naming the migration. Removal happens only in a major release. `migrate` rewrites an old profile.
- Warnings are data from the WASM, so the CLI, the core log and the SPA show identical text.

**Admission rule.** A format feature is admitted only when at least two vendors need it or the owner's own device does. The evidence table below is the record; a feature that fails waits.

**Bindings.** `modbus` (TCP, RTU over TCP, Solarman V5, with SunSpec built in), `http` (JSON paths, with auth kinds admitted per vendor) and `mqtt`. UDP, WebSocket and SML have one verified vendor each and wait.

**Read side.**

- Per point: register space (holding or input), an address base per profile, type (int and uint 16/32/64, float 32/64, string, bitfield, enum with arbitrary values, a register split into bytes), word order fixed per group or read from a register, a static scale or a scale factor read from a register, sentinels by type. A float point declares its stored resolution; a lint requires it. So does a point scaled by a register: its `scaleFactor` names the register holding a signed power of ten (SunSpec's `sunssf`), which the plan reads with the value; while it is unanswered the point has no value. A register's quantisation step (ADR 3) is the magnitude of its scale. A computed quantity takes the finest step of its inputs; a ratio, which has none, a thousandth of its scale.
- An `mqtt` point reads a `topic` under its connection's topic root (ADR 10); `{address}` in it stands for the device address. A JSON number payload is scaled like a register, `true` and `false` read as 1 and 0, and anything else (`null`, an empty or a text payload) is no value. A topic may map text payloads to values in an `enum` (EVCC's loadpoint mode); it then reads only those texts. Its step is the magnitude of its scale. A topic is a path without wildcards or a leading `/`. A profile reads through one binding: registers or topics, plus computed quantities.
- SunSpec is a built-in binding: find the base (40001, then 50001, then 1), check `SunS`, walk the model chain to `0xFFFF`, read scale factors with their values, treat sentinels as absent, map standard models to roles. One generic SunSpec profile covers conforming devices; vendor profiles add only what SunSpec lacks. The walk reads each header's ID and length in one request; a refused one is read again as the ID alone, since an end model may have no length (pysunspec2 reads it so). A chain that breaks before `0xFFFF` is no SunSpec map. Its identify probe is the walk itself: it proposes the generic profile, id `sunspec`, with the variant, the model after the common model (1). A SunSpec quantity names the models it reads (`model`, such as `[101, 102, 103]`, whose layouts agree) and its `register` and `scaleFactor` counted from the model's ID register, as the SunSpec model definitions (`sunspec/models`, `json/model_<id>.json`) lay it out. At connect it binds to the first listed model the chain holds; one the chain lacks, or past its model's length (a fourth MPPT module of three), stays unread. Double words read high word first. Each type's sentinel, from pysunspec2's `SUNS_UNIMPL_*`, is no value: `i16` 0x8000, `u16` 0xFFFF, `u32` 0xFFFFFFFF, and `acc32`, SunSpec's accumulator, 0; a scale factor of 0x8000 leaves its quantities without one. A profile reads SunSpec models or plain registers, not both. The generic profile maps the inverter models 101 to 103 (AC power as `pv.power`, lifetime energy, grid frequency, phase voltages), the MPPT extension 160 (up to four modules), the meters 201 to 204 (grid power, phase power and current, energy counters) and the battery model 802 (state of charge, capacity, voltage, current, power). The models leave the signs of meter and battery power open; it follows EVCC's generic SunSpec templates, a meter's power positive when importing and a battery's when discharging, negated to ADR 4's. A vendor whose device differs needs its own profile.
- Variants by device type, chosen by an identify probe (a magic register: `SunS`, `0xE3DC`, or a device-type register). A register profile declares its probe as `identify`: fields, each a `register` read at scale 1 as a `type` (`u16` when left out) and the `values` that identify the device. The device is identified only when every field answers one of its values; a field without values, or with one its type cannot hold, is refused. Deye's fields come from its three-phase protocol (`MODBUS RTU 三相储能通信规约` V105): register 0, the device type (`0x0500` low-voltage, `0x0600` and `0x0601` high-voltage three-phase hybrid), and registers 20 and 21, the rated power in 0.1 W, low word first.
- The unit id belongs to the device (ADR 6), not the profile.
- An inverter profile declares its MPPT inputs: count, maximum input current, voltage window and start voltage, and the inverter's maximum DC input voltage, from the datasheet (ADR 17, 20). They sit in an optional `inverter` section, inputs numbered from 1 in order as the `pv.mppt.*` index. The section may declare `acRating`, the rated AC output in watts, for the forecast's cap (ADR 17) and the AC limit. A profile covering a model family declares the family's largest limits until identify-probe variants split it, so a forecast never caps below the hardware.
- Storage class (`series`, `config`, `none`) and a deadband per role (ADR 3, 4).
- A quantity reads one register or computes over quantities declared before it (sum, difference, add and subtract, ratio, clamp; the owner's Deye). File order is evaluation order, so a cycle cannot be written and decoding is one pass. A missing input reads as 0, as in v4.
- Unknown fields are refused: a field this core does not know may change what a register means. Absent optional fields keep their schema 1 meaning (holding space, base 0, low word first) so admitting them stays additive.

**Read plan.** Compiled once at load, or at connect for SunSpec, where it covers every model of the chain but the headers. Contiguous registers coalesce into blocks of at most 120. A framing-specific gap tolerance merges blocks when a round trip costs more than the wasted registers: `tcp` 0, `rtu-over-tcp` 0, `solarman-v5` 32 (measured on one stick in v4: about 199 ms per read busy, 2 ms per register). The inputs of a computed role are read in one transaction for a single device snapshot. A merged block refused with Modbus exception 2 is split, a SunSpec block into its models' registers, and the split remembered. A flat list of decode operations runs per poll with no allocation. The same plan, at the `tcp` tolerance, serves the CLI's "decode this dump": a dump is a list of runs, `{ "start", "words" }`, and a block it does not cover in full decodes as unanswered, as a failed read does.

**Write side.** A setting is a recipe (ADR 7). It declares its type and scale, a `range` or its enumerated `values` (one is required, so no write is unbounded), a minimum interval, and a `readBack` register or quantity, or `writeOnly`. It may carry what the settings screen shows: a `name`, a `unit` of its scaled value (a role unit of ADR 4, written as its symbol, such as `A`), and `labels`, a text for each of its `values` keyed by the value; a label for a value it does not take is refused. They are part of its declaration, so a changed label switches an enabled setting off like any other change (ADR 8). Admitted step kinds: `write` (function code 6 or 16), `write-block`, `rmw` (mask), `unlock` with `finally` steps, `precondition`, `activate` (values, then an enable field last), `delay`, `snapshot-toggle` (the owner's Deye discharge lock) and `mqtt` publish. Live-control points are declared now: expiring setpoints with their revert time, heartbeat registers with their interval, and fallback values (SunSpec 123 and 704, Sungrow 13080, SolarEdge F310, Victron's 60 s rule). Only a controller under a lease may use them (ADR 7); the lint rejects them as admin settings. Not admitted yet: a commit register with status (SolarEdge only), function codes 5 and 23, SML, Speedwire.

Each step kind is its own capability (`write-block` for `writeBlock`).

- `precondition` requires a register, or the bits its `mask` selects, to hold one of its `values`. Preconditions come before every other step.
- `unlock` writes a secret of the device's connection, named by `secret`, as a decimal number of its `type`. It comes once, after the preconditions and before every write. Its `finally` lists fixed `words` written from a `register` to relock; it may be empty for a device that relocks itself.
- `writeBlock` writes fixed words and the value's words, at the `"value"` mark, in one function code 16 request of at most 123 registers.
- `rmw` reads its register afresh and writes it back with the value in the bits its `mask` selects. A value that overflows the mask is refused. `readBack` takes a `mask` too, so it compares only the field. A masked register holds a `u16`.
- `activate` writes a fixed word to an enable field. It is the last step, after one that writes the value.
- `delay` waits at most 10 s: every device on the endpoint waits with it.
- `snapshotToggle` names a `target` setting and the `locked` value it writes there. It is its setting's only step; the setting takes the values 0 and 1 and declares no `readBack` or `writeOnly`, since each write is the target's. The target is another setting of the profile, not a toggle, reads back and takes the locked value.
- `publish` (capability `publish`) sends the value, unretained and at most once (`QoS` 0), to a `topic` under the connection's root; `{address}` stands for the device address. Its `readBack` and its preconditions name a `quantity` read from a topic in place of a register, so they read the broker's retained state. A value publishes as the text its read-back quantity's `enum` maps it to, else as a number; a setting reading back through an `enum` takes only its values. A setting writes through its profile's binding: a profile reading topics publishes, one reading registers writes them.

**Official profiles.** A profile is official when it is signed (ADR 8) and a capture of a real device, recorded by `sunreye capture` (ADR 6), replays in `sim` and passes its tests. Deye's models ported from v4 have no capture of their own yet: they replay v4's oracle cases, register patterns run through their maps, and the SG05LP3 models of 14 to 20 kW also replay the owner's capture, whose read plan they share. Each writable setting carries `verified: true` only once its write was checked on real hardware. An unverified setting stays off until an admin enables it, as in a community profile.

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

Its WASM glue crate is an `unsafe` exception (ADR 2). MPPT limits are optional; without them the forecast applies no MPPT caps. A schema bump forces a core update, bounded by the previous-schema rule. Vendors this ADR could not verify (Growatt, Varta, Senec, sonnen's local API, FOX ESS, Anker, Marstek, Fenecon) are not supported until a primary document or a capture exists.
