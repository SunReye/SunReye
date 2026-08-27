# Multi-brand Modbus engine: register spaces, word order, S_DWORD/F32, SunSpec scale factors

## Context

The engine today is Deye-shaped: FC3 holding registers only, `U_WORD | S_WORD | U_DWORD` with hardwired low-word-first dwords, static per-metric scale. That caps brand compatibility at ~8% of the residential-hybrid market (Deye/Sunsynk, Victron). This change implements **Tier 1 + Tier 2** of the compatibility roadmap (~85% coverage):

- **Tier 1 (B0)**: per-metric register `space` (holding/FC3 vs input/FC4 — Sungrow, Growatt, Solis, GoodWe telemetry), `wordOrder` (`lsw` default vs `msw` — SunSpec, Huawei), new register types `S_DWORD` (signed 32-bit totals/grid power) and `F32` (IEEE-754 float — SunSpec float models).
- **Tier 2**: SunSpec dynamic scale factors — a metric's scale read from a sunssf register at decode time (Fronius, SMA, SolarEdge).

Hard constraints: fully backward compatible — every new field optional, defaults reproduce current behavior bit-identically; `schemaVersion` stays `1`; installed-profile JSON blobs in the DB re-validate unchanged at boot ([apps/server/src/inverter/inverter.ts:40-55](apps/server/src/inverter/inverter.ts)). Simulator ([simulator.ts](packages/inverter-core/src/simulator.ts)) and capabilities ([capabilities.ts](packages/inverter-core/src/capabilities.ts)) are engineering-unit/role-level and untouched. No DB migration.

**Verified greenfield**: no FC4/`readInputRegisters`, `wordOrder`, `sunspec`, or dynamic-scale concept exists anywhere in the repo today. No codec unit tests exist (first ones added here).

## Sequencing

- **Step 0 — prerequisite**: commit the uncommitted atomic-read-groups work in `packages/inverter-core` (driver.ts, types.ts, profile-data.ts, package.json + untracked driver.test.ts) — it rewrote `planReads` and this plan builds on that state. `feat(inverter-core): atomic register groups for computed metrics`.
- **Commit 1**: `feat(inverter-core): register spaces, word order, S_DWORD/F32 types`
- **Commit 2**: `feat(inverter-core): sunspec dynamic scale factors`

Two commits because Tier 2 layers on Tier 1's per-space register image, and review surfaces are disjoint (codec math vs SF semantics).

---

## Commit 1 — spaces, wordOrder, S_DWORD, F32

### types.ts ([packages/inverter-core/src/types.ts](packages/inverter-core/src/types.ts))

```ts
export type RegisterType = "U_WORD" | "S_WORD" | "U_DWORD" | "S_DWORD" | "F32" | "RAW";
/** Modbus register space: holding (FC3) or input (FC4). */
export type RegisterSpace = "holding" | "input";
/** Which listed register holds the least-significant word of a 2-register value. */
export type WordOrder = "lsw" | "msw";
```

New optional `MetricDef` fields (after `access`):

```ts
/** Register space this metric is read from. Default "holding" (FC3). */
space?: RegisterSpace;
/** For 2-register types: addresses[0] holds the least- ("lsw", default) or most-significant word ("msw"). */
wordOrder?: WordOrder;
```

Update `RegisterType` + `addresses` doc comments ("2 for U_DWORD/S_DWORD/F32").

### codec.ts ([packages/inverter-core/src/codec.ts](packages/inverter-core/src/codec.ts))

- `registerWidth`: `U_DWORD | S_DWORD | F32` → 2.
- Refactor `decode` to compute a **raw** number per type, then apply `raw * def.scale + offset` once at the end (Commit 2 hooks in there). Keep `?? 0` for missing data words (exact back-compat).
- New helper:
  ```ts
  /** [low, high] words of a 2-register value per the metric's word order. */
  function wordPair(def, regs): [number, number] | undefined
  // lsw (default): [regs.get(a0) ?? 0, regs.get(a1) ?? 0]; msw: swapped.
  ```
- Raw per type: `U_DWORD` = `low + high * 0x10000` (bit-identical to current line 35 under default lsw); `S_DWORD` = same then `u > 0x7fffffff ? u - 0x1_0000_0000 : u`; `F32` via DataView (default big-endian):
  ```ts
  const view = new DataView(new ArrayBuffer(4));
  view.setUint16(0, high); view.setUint16(2, low);
  const raw = view.getFloat32(0);
  ```
- `encodeWord` unchanged (writes stay single-word).

### driver.ts ([packages/inverter-core/src/driver.ts](packages/inverter-core/src/driver.ts))

Plan pipeline parameterized by space, run twice:

- `ReadBlock` gains required `space: RegisterSpace`. Helper `const spaceOf = (m: MetricDef) => m.space ?? "holding"`.
- `addressesOf` (line 37): replace the U_DWORD special case with width-driven slice — `m.addresses.slice(0, registerWidth(m.type, m.addresses))` (import from `./codec`); RAW/empty → `[]`.
- `readableAddresses(metrics, space)` / `splitIntoBlocks(sorted, space)` / `collectRawAddresses(..., space)` / `resolveAtomicGroups(metrics, space)`: thread `space` through; leaf collection only adds addresses of metrics in that space (still recurses computed deps unconditionally); emitted blocks stamped with `space`. A computed metric with inputs in both spaces gets one spanning block per space — cross-space atomicity is physically impossible (FC3/FC4 are separate transactions), no warning needed.
- `planReads` = `[...planSpace(metrics, "holding"), ...planSpace(metrics, "input")]`.
- `splitBlock(block, metrics)`: filter by `block.space`; sub-blocks inherit it.
- `read()` (lines 253-299): accumulator becomes `{ holding: Map, input: Map }`; per block pick `readInputRegisters` vs `readHoldingRegisters` by `block.space` and write into the matching map (both the normal path and the exception-2 grouped-fallback path). Decode loop: `decode(def, image[spaceOf(def)])` — **`decode` signature stays `(def, regs)`; the codec never learns spaces exist.** Read-plan log line: prefix blocks `H`/`I` (e.g. `I100+24`).
- `write()`: unchanged this commit (input registers are read-only by protocol — enforced by schema lint below, so no driver guard needed for space).

### profile-data.ts ([packages/inverter-core/src/profile-data.ts](packages/inverter-core/src/profile-data.ts))

`MetricDataDef` gains the same `space?` / `wordOrder?` fields (serialized mirror). `toMetricDef` needs no change (fields ride through the existing spread).

### schema.ts ([packages/inverter-core/src/schema.ts](packages/inverter-core/src/schema.ts))

- `registerTypeSchema` (line 18): add `"S_DWORD", "F32"`.
- `metricDataSchema` (strictObject, line 64): `space: z.enum(["holding","input"]).optional()`, `wordOrder: z.enum(["lsw","msw"]).optional()`.
- superRefine lints:
  1. **Dup-address lint per space** (lines 125-134): key owner map by `` `${m.space ?? "holding"}:${a}` `` — same address in different spaces is legal.
  2. **Width lint** (line 151): `U_DWORD | S_DWORD | F32` → 2.
  3. `wordOrder` on a non-2-register type → error.
  4. `space`/`wordOrder` on `computeExpr`/`controlExpr` metrics → error (fold into existing branch, lines 137-145).
  5. `space: "input"` + `access: "rw"` → error ("input registers (FC4) are not writable").

### define.ts ([packages/inverter-core/src/define.ts](packages/inverter-core/src/define.ts))

- `BaseMetricOpts` (lines 24-44): add `space?` / `wordOrder?` (doc comments as above).
- `metric()` (lines 107-133) builds its return object with **explicit fields** — add `space: opts.space, wordOrder: opts.wordOrder` (undefined values drop at JSON.stringify, same as `offset`).
- `MetricPatch`/`applyPatch` (line 245): nothing needed — verified new fields flow via `...rest`.
- `control()` untouched.

### index.ts + profile-sdk

- Export `RegisterSpace`, `WordOrder` from [index.ts](packages/inverter-core/src/index.ts) (mirror `RegisterType` export style).
- [packages/profile-sdk/src/scaffold.ts](packages/profile-sdk/src/scaffold.ts): `REGISTER_TYPES` (line 10) += `S_DWORD`, `F32` (`parseAddresses` already keeps multi-part addresses for non-WORD types — no change); new optional CSV columns `space` (`"input"` accepted) and `word_order` (`"msw"` accepted), emitted only when non-default; update docblock column list.

### Tests (Commit 1)

- **New `codec.test.ts`** (first codec tests in repo): `registerWidth` all six types; decode matrix `U_DWORD/S_DWORD/F32` × {absent, `lsw`, `msw`}. Vectors: U_DWORD `[0x0001,0x0002]` lsw → `0x20001`; S_DWORD −2 (low `0xFFFE`, high `0xFFFF`); F32 1.5 (high `0x3FC0`, low `0x0000`) + a negative via `Math.fround`; scale+offset on new types; back-compat guard (absent wordOrder ≡ old formula incl. missing-register-as-0); `U_WORD`/`S_WORD`/`encodeWord` regression cases.
- **Extend `driver.test.ts`**: add `space: "holding"` to existing expected blocks (mechanical); holding@100 + input@100 → two blocks, never merged; contiguous input metrics collapse into one input block; computed metric with cross-space inputs → one spanning block per qualifying space; `splitBlock` on input-space grouped block; `S_DWORD`/`F32` contribute both words to `addressesOf`.
- **Back-compat/defaults guard** (in codec.test.ts or `back-compat.test.ts`): inline Deye-style `defineProfile` fixture (U_WORD, offset S_WORD temp, `[low,high]` U_DWORD counter, computed sum) → `JSON.parse(JSON.stringify(...))` → `parseProfileData` → `hydrateProfile` → decode against hand-built register map, assert exact engineering values; `planReads` yields only holding blocks; a hand-written schemaVersion-1 JSON literal **without any new fields** passes `parseProfileData` (the installed-DB-blob guarantee). Do **not** import from Official-Profiles (separate repo, not a workspace dep).
- **`sdk.test.ts`**: schema accept/reject per lint list; `metric()` passthrough; family overlay patch of `space`.

---

## Commit 2 — SunSpec dynamic scale factors

### Field (types.ts + profile-data.ts + schema + define)

On `MetricDef`, `MetricDataDef`, `metricDataSchema` (`z.number().int().min(0).max(65535).optional()`), `BaseMetricOpts` + explicit `metric()` passthrough:

```ts
/**
 * SunSpec dynamic scale factor: address of an int16 "sunssf" register in the
 * SAME space as this metric. Effective value = raw * 10^sf * scale + offset.
 * SF word 0x8000 ("not implemented") makes the metric decode to undefined.
 * SF-scaled metrics are read-only.
 */
scaleFactorAddr?: number;
```

### codec.ts

In `decode`, after raw computation, before static scale:

```ts
if (def.scaleFactorAddr !== undefined) {
  const sfWord = regs.get(def.scaleFactorAddr);
  if (sfWord === undefined || sfWord === 0x8000) return undefined; // sunssf sentinel / never guess
  return raw * 10 ** toSigned16(sfWord) * def.scale + offset;
}
return raw * def.scale + offset;
```

Deliberate asymmetry: missing SF register → `undefined` (never guess a scale), while data words keep legacy `?? 0`.

### driver.ts

- `addressesOf`: append `m.scaleFactorAddr` when present (after the width slice). Planner then reads it automatically — same space by definition, merges into adjacent blocks (SunSpec puts sunssf next to its data), participates in atomic groups + `splitBlock` fallback with zero extra code.
- `write()` (before `getClient()`, alongside existing validations at lines 302-307): reject `scaleFactorAddr !== undefined` → `"metric uses a dynamic scale factor and is not writable"`. Covers every entry path (API, MQTT, composite controls funnel through driver write).

### schema.ts lints

1. `scaleFactorAddr` + `access: "rw"` → error.
2. `scaleFactorAddr` on `computeExpr`/`controlExpr` metric → error.
3. `scaleFactorAddr` on `type: "RAW"` → error.
4. `scaleFactorAddr` ∈ metric's own `addresses` → error (certain typo).
5. Deliberately **allowed** (normal SunSpec): many metrics sharing one SF address; an SF register also mapped as its own visible S_WORD metric. Do **not** add `scaleFactorAddr` to the dup-address owner map.

### scaffold.ts

Optional `sf_addr` CSV column → `scaleFactorAddr` when finite number. Update docblock.

### Tests (Commit 2)

- **codec.test.ts**: SF matrix — sf −1 (`0xFFFF`), 0, +2; combined with `scale ≠ 1` + `offset`; sentinel `0x8000` → undefined; missing SF register → undefined; SF on S_WORD (negative raw) and U_DWORD.
- **driver.test.ts**: plan includes SF addr (adjacent → merged block; distant → own block); SF of input-space metric lands in input plan; SF inside atomic group span; `splitBlock` keeps SF addresses; write rejection via `expect(inv.write(key, 1)).rejects.toThrow(/scale factor/)` (safe — validation precedes `getClient()`).
- **sdk.test.ts**: accepts shared-SF + SF-as-visible-metric; rejects lints 1-4; `metric()`/overlay passthrough.

---

## Not touched (verified)

`simulator.ts`/`generic-sim.ts` (engineering-unit, bypass codec) · `capabilities.ts`, `entities.ts`, manifest types (no register-level fields) · `apps/server` (single validation gate = `parseProfileData`; driver write guard covers all paths) · `repo.ts` fingerprint auto-bump (only profiles *using* new fields bump — intended) · Official-Profiles repo (no new fields present; unaffected).

Known follow-ups deliberately out of scope (document in authoring docs): multi-word (32-bit) writes, string registers, bitfields, direct serial RTU transport, non-Modbus sources (Enphase).

## Verification

```sh
bun test packages/inverter-core/src
bun test packages/profile-sdk/src
bun run check-types
bunx oxlint && bunx oxfmt
bunx fallow --format json   # dead code / dupes / health
```

Plus smoke: `bun run dev:server` in simulate mode (proves hydrate/boot path with new schema); against the real Deye inverter confirm identical readings (defaults guard, live).
