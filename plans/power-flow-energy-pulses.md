Verified against the real files: `power-flow-rails.svelte:66` (`filter: drop-shadow`), `power-flow-diagram.svelte:127-137` (`flowDuration`), `power-graph.ts:107-115` (`sense()` ±0.5 W deadband), `power-graph.ts:376` (`load-charger` has **no hub** in `pts` — kills any "hub is always `pts[last]`" helper), `sign-colors.ts:25-41`, `store.svelte.ts:30` (`latest` is a fresh object per sample — the real 1 Hz edge), `live-metrics.ts:19` (`fallow-ignore-next-line unused-export` precedent).

---

# 1. What changes

Each flowing rail stops being one anonymous dot conveyor and becomes a **comet stream at constant speed (80 px/s) whose density, head length, width and bloom rise with that cable's share of the plant's remembered peak**. A busy PV rail carries 8 fat glowing comets per 200 px; a 300 W night import carries one dim spark every 200 px, moving at exactly the same speed. Density changes by **fading additional interleaved comet layers in and out** — never by respacing a dash pattern, never by changing a duration — so nothing on screen ever teleports or accelerates. The `drop-shadow()` filter is deleted; the glow is a wider translucent round-capped stroke under each comet. The hub ring and the background wash breathe with total plant throughput, so at night the whole diagram is genuinely calm instead of pinned at full throttle.

---

# 2. The signal

New pure module **`apps/web/src/lib/inverter/flow-pulse.ts`** (peer of `power-graph.ts`/`sign-colors.ts`, plain `.ts` so it runs under `bun test`), plus a 25-line rune shell **`apps/web/src/lib/inverter/plant-ceiling.svelte.ts`** that owns only `$state` + `localStorage`.

**The reference is a remembered plant peak, not "the biggest rail right now".** Every judge killed max-of-current normalisation for the same reason: it pins the busiest cable at exactly 1.0 forever, so 300 W at 22:00 paints the same picture as 9 kW at noon. Two structural fixes:

- The ceiling tracks **total inbound throughput** (Σ|value| over `flow === 'in'`), not a single rail. Any one rail is then a genuine *fraction* of it — the busiest cable is ~0.7, not permanently 1.0.
- It decays by **wall-clock elapsed time, half-life 6 h**, not per invocation. That makes the fold idempotent — calling it twice in the same millisecond returns the same value — which structurally kills the "ratchet driven by render invalidation" flaw (EVCC's faster cadence, resize storms, `$derived` recompute all become harmless). Persisted to `localStorage` so a remount or an orientation flip doesn't restart the ramp.

```ts
// apps/web/src/lib/inverter/flow-pulse.ts
/** Comet speed, px/s. Constant for every rail: rate is density, never speed. */
export const PULSE_SPEED = 80;
/** Base span (px) one keyframe cycle travels. All dash periods divide it. */
export const PULSE_SPAN = 200;
/** The one animation-duration in the diagram: PULSE_SPAN / PULSE_SPEED. */
export const PULSE_PERIOD_S = PULSE_SPAN / PULSE_SPEED; // 2.5

/** Smallest plant a rail is ever measured against (W). */
export const CEILING_FLOOR_W = 1000;
/** How long the plant remembers its peak. Six hours: a 9 kW noon still dims a
 *  300 W midnight import to a single spark. */
const CEILING_HALF_LIFE_MS = 6 * 60 * 60 * 1000;

export type Ceiling = { watts: number; at: number };

/**
 * Rises instantly to what the plant is moving now, forgets slowly, never falls
 * below the floor. Decay is a function of ELAPSED TIME, not of call count — so
 * an extra invocation (a resize, EVCC's own cadence) cannot age it.
 */
export function decayCeiling(prev: Ceiling, nowMs: number, instantW: number): Ceiling {
  const elapsed = Math.max(0, nowMs - prev.at);
  const remembered = Number.isFinite(prev.watts)
    ? prev.watts * 2 ** (-elapsed / CEILING_HALF_LIFE_MS)
    : 0;
  const now = Number.isFinite(instantW) ? Math.abs(instantW) : 0;
  return { watts: Math.max(CEILING_FLOOR_W, now, remembered), at: nowMs };
}

/** Total power the plant is moving right now: what the ceiling is fed. */
export function throughputWatts(segments: readonly { flow: Flow; value?: number }[]): number {
  return segments.reduce((t, s) => (s.flow === "in" ? t + Math.abs(s.value ?? 0) : t), 0);
}

/** Magnitude relative to the remembered plant, quantized so a 1 Hz wobble
 *  writes no styles at all. Sign is carried by colour and travel direction. */
export function pulseShare(watts: number | undefined, ceilingW: number): number {
  const a = Math.abs(watts ?? 0);
  const c = Number.isFinite(ceilingW) && ceilingW > 0 ? ceilingW : CEILING_FLOOR_W;
  if (!Number.isFinite(a)) return 1;              // Infinity reads as full, not 0
  return Math.round(Math.min(1, a / c) * 20) / 20;
}
```

**The ladder** — the piece that makes density changes non-teleporting. Four co-animated layers, all sharing one duration and one travel distance, differing only by a **constant** dash period and a **constant** negative delay chosen so each layer's comets land exactly halfway between the layers below it:

| layer | dash period | delay | dots / 200 px once lit | union spacing |
|---|---|---|---|---|
| 0 | `SPAN` | `0` | 1 | 200 px |
| 1 | `SPAN` | `-T/2` | +1 | 100 px |
| 2 | `SPAN/2` | `-T/4` | +2 | 50 px |
| 3 | `SPAN/4` | `-T/8` | +4 | 25 px |

Because every period divides `SPAN` and the cycle travels exactly `SPAN`, the loop is seamless at every level, and lighting a layer **adds comets between the existing ones without moving any of them**. Density is therefore an *opacity fade of an already-running path* — the single most important property of this design.

```ts
/** Interleaved comet layers. `period`/`delay` are fractions of PULSE_SPAN and
 *  PULSE_PERIOD_S; both are constants of the design and never see a reading. */
export const PULSE_LAYERS = [
  { period: 1, delay: 0, from: 0, to: 0 },        // layer 0: any flow shows one comet
  { period: 1, delay: 1 / 2, from: 0.02, to: 0.18 },
  { period: 1 / 2, delay: 1 / 4, from: 0.22, to: 0.5 },
  { period: 1 / 4, delay: 1 / 8, from: 0.52, to: 0.95 },
] as const;

export type RailPulse = {
  share: number;
  /** Per-layer opacity, 0..1. Index 0 is always 1 on a flowing rail. */
  layers: number[];
  /** Comet head length (px) — grows forward from a fixed dash start. */
  dot: number;
  /** Core stroke width (px); the bloom is 2.6x this. */
  width: number;
  /** Bloom stroke-opacity. */
  glow: number;
};

export function railPulse(watts: number | undefined, ceilingW: number): RailPulse {
  const share = pulseShare(watts, ceilingW);
  return {
    share,
    layers: PULSE_LAYERS.map(({ from, to }) =>
      to <= from ? 1 : Math.min(1, Math.max(0, (share - from) / (to - from))),
    ),
    dot: round1(5 + share * 9),
    width: round1(3 + share * 1.5),
    glow: round2(0.12 + share * 0.22),
  };
}

/** Inline style for layer `i`. Its ONLY input is the layer index — that is what
 *  makes the delay a constant of the design rather than a datum. */
export function layerStyle(i: number): string {
  const l = PULSE_LAYERS[i]!;
  return `--lvl-period:${l.period * PULSE_SPAN}px;--lvl-phase:${l.delay * PULSE_SPAN}px;animation-delay:-${l.delay * PULSE_PERIOD_S}s`;
}

/** Comet positions inside one base span at a given lit-layer count — the proof
 *  that lighting a layer interleaves rather than respaces. Tests only. */
// fallow-ignore-next-line unused-export -- the interleaving invariant is the whole design; its test asserts on it
export function dotPositions(lit: number): number[] { … }
```

## Tests first — `apps/web/src/lib/inverter/flow-pulse.test.ts`

- **Relativity (why the feature exists):** rails `[5000, 500]` and `[500, 50]` against their own ceilings produce identical `RailPulse`s.
- **Calm at night (the flaw every judge raised):** `railPulse(300, 9000)` lights layer 0 only, `glow` within 0.02 of its floor — while `railPulse(6000, 9000)` lights all four. Comment it as the reason max-of-now normalisation was rejected.
- **The busiest rail is not pinned at 1:** with segments `pv 5000 in`, `load 3000 out`, `grid 2000 out`, the pv rail's share is < 1 because the ceiling tracks the inbound sum.
- **Decay is time-based and idempotent:** `decayCeiling(c, t, x)` called twice at the same `t` is `toEqual`; six hours of elapsed time halves it; it never falls below `CEILING_FLOOR_W`; a spike raises it in the same call; `at: NaN`/`watts: NaN` degrade to the floor.
- **1 Hz no-jump scar:** `railPulse(1000, 9000)` `toEqual` `railPulse(1004, 9000)`.
- **Magnitude, not sign:** `-3000` ≡ `+3000`.
- **Boundaries:** `undefined`, `0`, `-0`, `Infinity`, `NaN`, ceiling `0` → no NaN, `share`/`glow`/every `layers[i]` ∈ [0,1], `layers` monotonically non-decreasing in `share`, `layers[0] === 1` always.
- **Ladder invariants:** every `period * PULSE_SPAN` divides `PULSE_SPAN` exactly; `dotPositions(n)` is evenly spaced for n = 1..4 with spacing `PULSE_SPAN / 2^(n-1)`; `layerStyle(i)` contains no reference to watts and is a pure function of `i`.
- **`nodeGlow(accent, share)`** returns a `color-mix(in oklab, …)` string, never a hex.

Prove them per TESTING.md:117 — un-quantize `pulseShare`, swap `decayCeiling` for a per-sample decay, and watch the two named cases go red before writing the component.

---

# 3. The render — `_shared/power-flow-rails.svelte`

Pass 1 (static `text-border` dotted rail, all segments) is untouched. Pass 2 becomes, per **flowing** segment, one `<g>` carrying four transitionable custom properties and 4 layers × 2 strokes (bloom + core).

```svelte
{#each flowing as l (`${l.id}-${l.flow}`)}
  <g
    class={`pulse ${l.flow === 'in' ? 'pulse-in' : 'pulse-out'} ${l.color}`}
    style={`--pulse-dot:${l.pulse.dot}px;--pulse-w:${l.pulse.width}px;--pulse-glow:${l.pulse.glow}`}
    transition:fade={{ duration: fadeMs }}
  >
    {#each l.pulse.layers as opacity, i (i)}
      <path class="bloom" d={l.d} style={layerStyle(i)} stroke-opacity={opacity * l.pulse.glow} />
      <path class="core"  d={l.d} style={layerStyle(i)} stroke-opacity={opacity} />
    {/each}
  </g>
{/each}
```

```css
@property --pulse-dot  { syntax: '<length>'; inherits: true; initial-value: 5px; }
@property --pulse-w    { syntax: '<length>'; inherits: true; initial-value: 3px; }
@property --pulse-glow { syntax: '<number>'; inherits: true; initial-value: 0.12; }

/* Intensity glides between 1 Hz samples. None of these is a timing property. */
.pulse { transition: --pulse-dot 700ms linear, --pulse-w 700ms linear, --pulse-glow 700ms linear; }

.pulse path {
  fill: none;
  stroke: currentColor;              /* text-sign-* from sign-colors.ts */
  stroke-linecap: round;
  /* Dash STARTS are fixed by the period; only the head grows forward, so a
     changing --pulse-dot lengthens a comet without moving it. */
  stroke-dasharray: var(--pulse-dot) calc(var(--lvl-period) - var(--pulse-dot));
  animation-duration: 2.5s;          /* PULSE_PERIOD_S — a literal, never a datum */
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}
.core  { stroke-width: var(--pulse-w); }
/* The bloom replaces filter: drop-shadow() — plain paint, no filter region. */
.bloom { stroke-width: calc(var(--pulse-w) * 2.6); }

.pulse-in  path { animation-name: pulse-in; }
.pulse-out path { animation-name: pulse-out; }
/* Travel is exactly one base span, an integer multiple of every layer's
   period, so the loop is seamless at every density. */
@keyframes pulse-in  { to { stroke-dashoffset: -200px; } }
@keyframes pulse-out { to { stroke-dashoffset:  200px; } }

@media (prefers-reduced-motion: reduce) {
  .pulse { transition: none; }
  .pulse path {
    animation: none;
    /* Park each layer at its phase: evenly spaced beads whose count, size and
       bloom still encode relative power. */
    stroke-dashoffset: calc(var(--lvl-phase) * -1);
  }
}
```

**Tokens.** Nothing new. Colour is `currentColor` off the existing `l.color` (`text-sign-good/warn/bad` from `sign-colors.ts`), bloom is alpha on that same token, so `token-usage.test.ts:44` (no `var(--color-chart-`) and `energy-tokens.test.ts:197` (`SCREENS.diagram` separation floor — no new hue) both hold by construction, and no palette preset needs re-authoring. No new class strings are emitted from TS, so the Tailwind scanner sees everything it already saw. No `md:`; no new `border` + `p-*` combination, so `section-migration.test.ts:318` stays quiet.

**Why not `pathLength`.** Design 3's `pathLength="100"` normalises dash *lengths* but not stroke widths or round caps, so identical watts render as a dot on a 200 px rail and a streak on an 800 px one. Everything here is in real pixels: comet length, spacing, width and speed are identical on every cable in the diagram, and arrival rate (`lit layers / 2.5 s`) is rail-length-independent.

---

# 4. System touches

**Take:**
- **Hub ring amplitude** — `--plant-level` (`throughput / ceiling`, quantized to 0.05) set **on the `.hub-ring` span only**, `inherits: false`. Existing `hub-pulse` keyframe gains `calc()` amplitude. At night the ring barely ticks; at noon it flashes. Scoping it to one element avoids re-resolving style for the whole node subtree every frame.
- **Background wash** — the existing `radial-gradient` div gets `opacity: calc(0.4 + 0.6 * var(--plant-level))` with `transition: opacity 900ms linear`. Transition a plain `opacity`, **not** a `color-mix` percentage inside a `background` — that would repaint a hero-sized gradient continuously.
- **Node glow** — `PowerFlowNode` gains `share`, and `circleStyle`'s existing `box-shadow` interpolates through the pure `nodeGlow(node.accent, share)`. Zero new elements, zero new animations; it rides the `transition-[box-shadow,…] duration-500` that is already on the box.

**Skip:** node halo beat (strobe risk, ≤9 new animated elements), plant-wide phase lock (`use:` action calling `getAnimations()` at mount almost certainly returns `[]`, degrades silently, and unison across every rail reads as a pulsing wall clock), per-arrival flash elements, and any JS-spawned particle.

---

# 5. Jitter, reduced motion, perf

**Jitter — five layers, each addressing a specific failure the judges found:**

1. `animation-duration` is the literal `2.5s` and `animation-delay` comes from `layerStyle(i)`, whose only input is the layer index. `flowDuration()` is deleted. No timing property can be reached by a reading, so elapsed time can never be remapped.
2. `stroke-dasharray`'s *period* never changes (it is a per-layer constant), so comets never respace. Only the head length grows, forward from a fixed dash start — a non-moving change.
3. Density changes are **opacity fades of paths that never stopped running** — the one channel with no positional discontinuity at all. This is what the power-of-two interleave buys, and it replaces both the dasharray-teleport of Design 1/3 and the slot pop-in of Design 2.
4. **Flow reversal and deadband crossings** — the case Design 2 was killed for. The each-key is `` `${l.id}-${l.flow}` ``, so a reversal replaces the group under a 300 ms `fade`: the outgoing comets fade while the incoming ones fade in at their own phase. No mirrored teleport, and an idle↔flowing crossing of `sense()`'s ±0.5 W deadband becomes a deliberate fade rather than a pop.
5. Continuous outputs are `@property`-registered and transitioned 700 ms; `pulseShare` is quantized to 1/20, so most 1 Hz samples produce a byte-identical object and write nothing. Hysteresis is not needed anywhere, because no output has a visible discontinuity to oscillate across.

**Reduced motion** — CSS-only in the rails and diagram (`@media (prefers-reduced-motion: reduce)`, matching the block already at `power-flow-rails.svelte:85` and pinned by `primitives.test.ts:139`): animations off, transitions off, each layer parked at `--lvl-phase` so the beads stay evenly interleaved and *still encode intensity* through count, length, width and bloom. The one JS touch is `fadeMs`, from `new MediaQuery('(prefers-reduced-motion: reduce)')` (`svelte/reactivity`, the `section-body.svelte:18` precedent) → `0`, because a Svelte transition cannot be gated in CSS.

**Perf** — 8 paths per *flowing* segment: 24–32 typical (3–4 flowing per RECON C), 72 in the 9-segment pathological case. Against that, **every `filter: drop-shadow()` in the rails is deleted** — a filtered re-raster of each path's full bbox every frame, frequently not GPU-accelerated, and the same shape as the layerchart band-count INP incident. Unfiltered thin-stroke dash animations repaint a small dirty rect. No `will-change` anywhere (layer explosion on a cheap panel), no rAF, no `getTotalLength()`, no DOM churn per sample — the layer count is structurally fixed, only inline custom properties change. Levers if a trace demands them, in order: drop `PULSE_LAYERS` to 3, then drop the bloom on layers 2–3. **Verify with `performance_start_trace` on the real wall panel before the DESIGN.md commit lands** — the element count is the one claim here that must be measured rather than argued.

---

# 6. Diff plan

1. **`feat(web): a plant ceiling the diagram can be measured against`**
   `lib/inverter/flow-pulse.ts` (ceiling + throughput + share) and `flow-pulse.test.ts`; `lib/inverter/plant-ceiling.svelte.ts` shell (localStorage seed/persist, pure parse+decay tested in 1). No component change.
2. **`feat(web): the interleaved pulse ladder`**
   `PULSE_LAYERS`, `railPulse`, `layerStyle`, `dotPositions`, `nodeGlow` + tests, including the even-spacing invariant that proves lighting a layer interleaves rather than respaces.
3. **`refactor(web): rails shoot pulses instead of dashes`**
   Rails rewrite; `power-flow-diagram.svelte` loses `flowDuration` and `RailLine.dur`, gains the ceiling `$effect` keyed on `inverter.latest` and `pulse: railPulse(...)`. New `lib/components/inverter/power-flow-pulse-wiring.test.ts`: no `flowDuration(`, no `filter:` in the rails, `animation-duration` is a literal, `animation-delay` appears only inside `layerStyle`, the identifier bound from `railPulse(` is the one that reaches `RailLine`, the each-key includes `l.flow`, and the `prefers-reduced-motion: reduce` block names every class the file gives an `animation:` to (class list scraped from the file, not restated).
4. **`feat(web): hub and nodes answer the plant's load`**
   `--plant-level` on the hub ring, background wash opacity, `share` → `nodeGlow` on `power-flow-node.svelte`; extend the wiring test (`--plant-level` is set on the ring, not the root; the wash transitions `opacity`, not a `color-mix` percentage).
5. **`docs(web): motion carve-out for the power-flow diagram`**
   Amend `DESIGN.md:17-25` / `:287-316`: continuous flow motion is a status display, not decorative UI transition; it is amplitude-modulated by real throughput so an idle plant is nearly still; it runs on one constant period; it degrades to static interleaved beads under reduced motion. Without this, the next reader is entitled to revert commit 3 on sight.

Gates: `bun run test` (root), `cd apps/web && bun run check`, `bunx fallow audit` on the staged state each commit. Coverage floor 0.99/0.98 — every export in `flow-pulse.ts` is called by a test, `dotPositions` carries the `fallow-ignore-next-line unused-export` comment (the `live-metrics.ts:19` precedent).

---

# 7. Rejected

- **Max-of-current-segments normalisation** (all three designs) — pins the busiest cable at exactly 1.0 forever; 300 W at midnight paints like 9 kW at noon. Replaced by a 6-hour-half-life ceiling over *inbound throughput*.
- **Per-sample decay of the reference** — its rate silently depends on how often Svelte recomputes (EVCC cadence, resize storms). Replaced by wall-clock decay, which is idempotent.
- **Density via a changing `stroke-dasharray` period** (Designs 1 & 3) — respacing teleports every comet on the rail; hysteresis only makes it rarer, not invisible. Replaced by the power-of-two interleave with opacity fades.
- **`animation-duration` derived from anything** (today's `flowDuration`, Design 1's `railDuration`) — the original scar; duration is now a literal.
- **`pathLength="100"`** — normalises dash lengths but not stroke widths or round caps, so identical watts read differently per rail. Everything is in real pixels instead.
- **Design 1's `--lead` keyframe offset** — transitioning a length that the keyframe's start/end both read surges the bloom layer ~10 % of the path ahead of the head for the transition's duration, on `in` rails only.
- **`offset-path` particles** (Design 2) — swapping `offset-path` on a flow reversal teleports every comet; the span pool is destroyed whenever a rail crosses `sense()`'s ±0.5 W deadband; and support on an unknown kiosk engine silently falls back to the old look.
- **Plant-wide phase lock / heartbeat** (Design 3) — `getAnimations()` at mount usually returns `[]`, so it degrades to unsynchronised rails with no test able to catch it; and true unison across every rail and node reads as a strobing wall clock.
- **Inherited transitioned `--plant-level` on the diagram root** — re-resolves style for the entire node subtree, `AnimatedNumber` included, ~90 % of every second. Scoped to the ring; the wash transitions plain `opacity`.
- **Node halo beat elements, per-arrival flashes, JS-spawned particles** — new animated elements for a signal already carried by the node's existing transitioned `box-shadow`.