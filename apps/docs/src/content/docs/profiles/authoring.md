---
title: Authoring a Profile
description: Describe a new inverter with the typed profile SDK, validate it, and score its coverage.
---

You describe an inverter *as code* using the typed builders in
[`@sunreye/profile-sdk`](https://www.npmjs.com/package/@sunreye/profile-sdk) (`bun add -d
@sunreye/profile-sdk`), compile it down to a serializable `ProfileData`, then validate and
score it with the same package's CLI. The SDK's job is to make the profile
**correct by construction** — picking a role forces you to supply exactly what that role
needs, or the code won't compile.

## `defineProfile` and `metric`

```ts
import { defineProfile, metric } from "@sunreye/profile-sdk";

export const acme = defineProfile({
  id: "acme-hybrid",
  name: "Acme Hybrid",
  manufacturer: "Acme",
  version: "1.0.0",
  metrics: [
    metric("dc/pv1/power", {
      label: "PV1 Power", group: "solar",
      role: "pv.string.power", index: 1, addr: 672, unit: "W",
    }),
    metric("battery/soc", {
      label: "Battery SoC", group: "battery",
      role: "battery.soc", addr: 588, unit: "%",
    }),
    metric("settings/work_mode", {
      label: "Work Mode", group: "settings",
      role: "setting.work_mode", access: "rw", addr: 142,
      enumLabels: { 0: "Selling First", 1: "Zero Export", 2: "Limited to Load" },
    }),
    metric("grid/total/power", {
      label: "Total Grid Power", group: "grid",
      computeExpr: { sum: ["grid.phase.power.1", "grid.phase.power.2"] },
    }),
  ],
});
```

`metric(topic, opts)` derives the entity `key` from the topic (`dc/pv1/power` →
`dc.pv1.power`) and defaults `type` (`U_WORD`), `scale` (`1`), `access` (`r`), and `unit`
(`null`) so the common case stays terse.

### The role makes the type demand its shape

The `role` you choose narrows what the rest of the argument must contain, read from the
[role catalog](/profiles/concept/#the-role-catalog):

- An **indexed** role (`pv.string.power`) ⇒ `index` is **required**.
- A **status/enum** role (`inverter.status`, `setting.work_mode`) ⇒ `enumLabels` is
  **required**.
- A **setting** (writable) role ⇒ `access: "rw"` is **required**.

Omit any of these and it's a compile error. A metric with **no role** is allowed — it's a
diagnostic value that isn't rendered by role.

### Storage: what is worth keeping, and how finely

Two optional fields decide how much of a register's history reaches disk. Both default to
something sensible, so a profile that omits them behaves exactly as before — but only the
vendor map knows what a register is *worth*, which is why they are authored here rather
than guessed downstream.

```ts
metric("ac/l1/voltage", {
  label: "Grid Voltage L1", group: "grid",
  role: "grid.phase.voltage", index: 1, addr: 598, unit: "V", scale: 0.1,
  deadband: 1,            // store a change of 1 V or more, in the metric's own unit
});

metric("settings/battery/maximum_charge_current", {
  label: "Max charge current", group: "settings",
  role: "setting.battery.max_charge_current", access: "rw", addr: 108, unit: "A",
  storage: "series",      // the automation engine writes this; its history is worth charting
});

metric("settings/system_time", {
  label: "System time", group: "settings", type: "RAW", addr: [22, 23, 24],
  storage: "none",        // a packed register that is never part of the numeric sample
});
```

**`storage`** — where the values go:

| Value | Meaning |
| --- | --- |
| `series` | change-only rows in the timeseries table (the default for everything read-only) |
| `config` | a change-log: one row when the value actually changes (the default for every writable register) |
| `none` | live feed only, never persisted |

The default is derived from the metric's kind, and it is a *default*, not a law. Configuration
registers were 34 % of every row one measured profile wrote, re-persisting an unchanged schedule
slot on every poll — hence `config` for writable registers. But a setting your automation writes
is genuinely worth charting, and a diagnostic measurement may be worth no storage at all, so
either can be overridden.

**`deadband`** — the smallest change worth storing, **in the metric's own unit**:

- It is compared against the last value that was **stored**, carried forward — not against the
  previous sample. That makes the error bound *equal* to the threshold: `deadband: 1` on a
  voltage means the stored series is never wrong by more than 1 V. (Comparing against the
  previous sample instead is unboundedly wrong: a signal drifting 0.9 V per reading never trips
  a 1 V per-sample threshold and is never stored at all.)
- **Absence means "store every change".** There is no `deadband: 0` — a zero would make "not
  applicable" indistinguishable from a real threshold of zero, so validation rejects it.
- It must be at least `scale`: a threshold below the register's own quantisation step is
  unrepresentable, so it is an authoring error rather than a no-op.
- It is rejected on a **counter** or a **status enum**. A threshold makes a monotonic counter lag,
  and on an enum it can swallow a state transition. Those are always stored exactly.

Pick values off the datasheet and stay inside instrument noise. The official Deye profiles use
20 W, 1 V (0.1 V on the battery pack), 0.2 A and 0.5 °C — each above the register's own step and
well inside the noise floor.

### Addresses by register type

- `U_WORD` / `S_WORD` → one address: `addr: 672`
- `U_DWORD` → two addresses `[low, high]`: `addr: [672, 673]`
- computed (`computeExpr`) → no `addr`

### Compute expressions

Derived metrics use a small **closed** set — never arbitrary code:

| Expression | Meaning |
| --- | --- |
| `{ sum: ["a", "b", …] }` | Add the listed metric keys. |
| `{ diff: ["a", "b"] }` | `a − b`. |
| `{ scale: ["a", k] }` | `a × k`. |
| `{ combine: { add: [...], sub: [...] } }` | Sum of `add` keys minus sum of `sub` keys — a signed linear mix. `sub` is optional. |
| `{ ratio: { num: [...], den: [...], scale? } }` | `(Σnum / Σden) × scale` (`scale` defaults to `1`). A zero denominator reads as `0`, so idle/overnight samples never divide by zero. |

Referenced keys are resolved from the live sample at compute time; a **missing key reads as
0**. A computed metric may only reference metrics defined **earlier** (no forward references).

:::tip[Keep a computed metric's inputs close together]
The engine samples all the raw registers feeding a `computeExpr` (resolved transitively) in
**one Modbus read**, so a derived value like efficiency never mixes registers read milliseconds
apart. This only works when those inputs fit within a **120-register window** (the per-read cap).
Inputs spread wider than that can't share a transaction and the computed value can spike on fast
power transients — declare a `range` so the engine at least clamps it. The single read also spans
any unmapped registers between the inputs, so the device must tolerate reading them (those that
don't fall back to split reads automatically, with the same transient-spike caveat).
:::

### Deferred aggregates: `sumOf`

A hand-listed `sum` drifts the moment a model adds or drops a member. `sumOf` lets you
declare the **intent** once — "sum every PV-string power" — and resolves it to a concrete
`{ sum: [...] }` against the *final* metric set at build time:

```ts
import { metric, sumOf } from "@sunreye/profile-sdk";

metric("dc/total_power", {
  label: "PV Total", group: "solar", unit: "W",
  role: "pv.total.power",
  computeExpr: sumOf({ role: "pv.string.power" }), // every metric carrying this role
});
```

Select members by **`role`** (every metric with that canonical role) or by **`keyPrefix`**
(the exact key plus every `${prefix}.` descendant, e.g. `sumOf({ keyPrefix: "battery.bank" })`);
the carrier never sums itself. The token is resolved and **stripped before validation**, so
an emitted profile still contains only the closed `{ sum: [...] }` form and the runtime
engine sees nothing new. **Fail-loud:** an aggregate that matches zero metrics is a build
error, never a silent empty sum.

The payoff shows up in families (below): because it resolves against *each model's*
surviving metrics, a variant that drops a PV string re-derives the correct total on its own
— no per-model patch.

## Families & model variants

A single repo holds **as many profiles as you like** — hundreds is fine (`index.json` plus
one `profiles/<id>.json` per model). When a manufacturer ships several models on the same
register map that differ only in a few limits or PV inputs — e.g. the Deye SG05LP3-EU-SM2
line, whose SUN-14K…SUN-20K SKUs share everything but their battery current ceiling — don't
copy the whole map. Author them as a **family**: one shared base plus a `models` record
keyed by profile id.

```ts
import { defineFamily, metric } from "@sunreye/profile-sdk";

export const acme = defineFamily({
  id: "acme-hybrid",           // the generic base profile, emitted first
  name: "Acme Hybrid",
  manufacturer: "Acme",
  version: "1.0.0",
  metrics: [ /* the shared register map: 2 PV strings, a writable discharge limit, … */ ],
  models: {
    "acme-hybrid-5k": {
      name: "Acme Hybrid 5K",
      metrics: {
        "dc.pv2.*": null,                                            // one MPPT
        "settings.battery.maximum_discharge_current": { max: 120 },
      },
    },
    "acme-hybrid-15k": {
      name: "Acme Hybrid 15K",
      metrics: { "settings.battery.maximum_discharge_current": { max: 280 } },
    },
  },
});
```

`defineFamily` returns `[base, ...models]` — the generic base first (still selectable), then
one **self-contained** `ProfileData` per model. Export it and `profile build` picks up every
profile at once; each appears in SunReye's model picker, so a user selects their exact model
and its limits follow.

### The overlay: one rule per entry

Each `models[id].metrics` is a record keyed by canonical metric key that overlays the base:

| Entry | Effect |
| --- | --- |
| `"key": { max: 280 }` (or `min`, or any `metric()` field like `addr`/`scale`) | **patch** — merge those fields into that metric; `min`/`max` set its `range` |
| `"key": null` | **remove** that metric |
| `"prefix.*": null` | **remove** every metric under the prefix (e.g. a whole PV string) |
| `"new.key": { …full definition… }` | **add** a new metric (topic derived from the key, `.` → `/`) |

Keys **autocomplete** from the base map (the base's key union is threaded through the model
types). Because wildcards and adds are also arbitrary strings, a typo can't be told apart
from an add by the compiler — instead it's caught at build/load time: patching or removing a
key that isn't in the base throws, as does a wildcard that matches nothing.

Because [capabilities are *derived*](/profiles/concept/), not declared, these edits reshape
the manifest automatically: dropping `dc.pv2.*` makes the UI report one PV string, and a
`range` on a writable setting renders a capped slider that also **rejects out-of-range
writes** server-side (that's how "SUN15 = max 280 A discharge" is enforced end to end). No
schema, hydrate, or server change is involved — the whole feature is authoring-side data.

To specialize a single imported or third-party `ProfileData` instead of a co-located base,
use the low-level primitive `defineVariant(base, { id, name?, metrics? })`.

### Removing a metric that others reference

Dropping a metric another one depends on used to fail late and opaquely (a
`references unknown metric key` error at load). `defineFamily`/`defineVariant` now reconcile
the survivors as part of applying the overlay:

- a removed key inside a **variadic** compute list (`sum`, `combine.add`/`sub`,
  `ratio.num`/`den`) is **pruned** from it — the same edit you'd make by hand;
- a removed key inside a **fixed-arity** expr (`diff`, `scale`), one whose removal would
  **empty a required list**, or a **control target**, **throws** at build time — naming both
  metrics — rather than silently changing the value (an emptied `ratio.den`, say, would read
  a constant `0`).

So removing `dc.pv2.*` from a base whose `dc.total_power` is
`{ sum: ["dc.pv1.power", "dc.pv2.power"] }` leaves `{ sum: ["dc.pv1.power"] }` with **no
manual patch**. Author the total as [`sumOf({ role: "pv.string.power" })`](#deferred-aggregates-sumof)
and the base carries no explicit key list at all — every model's total simply tracks its own
strings.

## Validation

A single Zod schema is the gate for **every** ingested profile — at author time, at
download time, and at server boot. It is strict:

- unknown keys are rejected;
- addresses are bounded (0–65535) and their count must match the register `type`;
- **semantic lints**: duplicate keys, duplicate wire addresses, indexed role without
  `index`, enum role without `enumLabels`, setting role without `rw`, and `computeExpr`
  referencing unknown or forward keys.

Because a profile is pure data, a bad profile can only fail validation or produce an empty
manifest — **it can never execute code**.

Within a family the SDK catches dependency breakage a step earlier still: an overlay that
removes a metric a survivor references throws at `defineFamily`/`defineVariant` time, naming
both metrics, before the profile ever reaches this schema (see
[Removing a metric that others reference](#removing-a-metric-that-others-reference)).

## The `profile` CLI

`@sunreye/profile-sdk` ships a `profile` command with three subcommands. It exits non-zero
on failure, so it works as a CI or pre-commit gate.

### `profile validate <file>`

Runs the strict schema + semantic lints against a `ProfileData` JSON file. Prints `✓` or a
list of `• path: message` issues.

```bash
bunx profile validate ./profiles/acme.json
```

### `profile coverage <file>`

Validates, then reports how many canonical roles are mapped and which are missing —
directly telling you what *won't* render:

```
mapped 31/50 canonical roles
missing: grid.power, battery.soc, pv.string.power[] …
```

Indexed roles are marked with `[]`.

```bash
bunx profile coverage ./profiles/acme.json
```

### `profile scaffold <csv>`

Turns a vendor Modbus register-table CSV into a starter `ProfileData` (roles left unmapped
for you to fill in). Columns: `topic,label,unit,group,addr,type,scale,access` (order-
independent; `topic` required; multi-register `addr` is `|`-separated). Prints JSON to
stdout for piping and hand-editing:

```bash
bunx profile scaffold ./deye-registers.csv \
  --id acme-hybrid --name "Acme Hybrid" --manufacturer Acme --version 0.1.0 \
  > profiles/acme.json
```

The real authoring work is transcribing the register map and assigning roles; scaffold gives
you the skeleton.

### `profile build <entries...> --out <dir>`

Turns code-defined profiles into a complete, installable
[profile repo](/profiles/distribution/): validates every profile, writes one
`profiles/<id>.json` per profile, and regenerates the root `index.json`:

```bash
bunx profile build ./src/profiles.ts --out . --name "My Profiles" --maintainer you
```

An entry is either a `ProfileData` JSON file or a TS/JS module — every export that is a
profile, a `{ profile, description }` wrapper (the description shows up in SunReye's repo
browser), or an array of either gets included. Any invalid profile or duplicate id fails
the whole build, so a broken repo never gets published. The same logic is available
programmatically as `buildRepo(entries, { name, maintainer })`.

### Change-aware versioning

Because SunReye's [update checker](/profiles/distribution/#update-checking) is **semver-aware**,
a profile only shows an update when its version genuinely increases. `profile build` handles
this for you: it reads the **previously built** `profiles/*.json` under `--out` and compares
each profile's *content* (everything but its `version`, order-independent) against it.

- **Unchanged** content keeps the published version — no churn, no false "update available".
- **Changed** content is **auto-bumped** (default `--bump patch`; `minor` / `major` also
  accepted) above the last published version.
- A version you **raised yourself** in source is respected (*bumped by author*).
- A **new** profile (or a first build with nothing prior) is published as-authored.

The build summary reports the outcome per profile (e.g. `acme-hybrid@1.0.1 (bumped from
1.0.0)`), so the flow stays *edit → build → commit → push* without hand-editing versions.

## Testing without hardware

The SDK's test harness (`exerciseProfile`) runs a `ProfileData` end to end offline —
validate → hydrate → build the manifest → derive capabilities → generate one simulated
sample — so you can assert identity and capabilities in a unit test with **zero hardware**.

## Publishing

Once a profile validates and covers the roles you need, publish it to a git repo so others
can install it at runtime — see [Distributing Profiles](/profiles/distribution/).
