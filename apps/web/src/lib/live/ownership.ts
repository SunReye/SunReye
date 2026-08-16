/**
 * Who owns which number.
 *
 * The rule this table makes enforceable: **a measured register is owned by the
 * feed that reads the register; a decided value is owned by the feed that
 * decided it; no consumer merges the two.**
 *
 * It exists because of a bug seen on the running plant. The peak-shaving panel
 * read house load as `liveRole('load.power') ?? status.loadW` — the metrics
 * topic first, the automations status as a fallback. On a profile without a
 * `load.power` role the fallback won, so the tile showed a number the engine
 * had decided on at `controlIntervalS` (30 s here) while `AnimatedNumber` kept
 * gliding it across the 1 Hz metrics cadence. It finished animating in about a
 * second and then sat dead for twenty-nine. A frozen number at least looks
 * broken; that one looked alive and was wrong.
 *
 * The fallback is only ever tempting because two topics can both *produce* a
 * plausible number for the same quantity. Naming one owner removes the choice:
 * where the owner is silent the UI says so (see `plant.ts`), and the other
 * feed's copy stays what it always was — an audit trail of what the engine
 * decided on, not an alternate source for a "now" tile.
 *
 * Plain TS, no runes: this is the whole rule, and it is tested.
 */

/** Topics that produce a value some card renders. `logs` produces none. */
export type OwningTopic = "metrics" | "automations" | "evcc" | "statistics";

/**
 * Every logical value the dashboard shows, under its one owner.
 *
 * Metric ids are the canonical role names verbatim: for those, the topic *is*
 * the register, sampled at the poll cadence. Everything else is namespaced by
 * its owner, which is what keeps a rollup-integrated `statistics.energy.today`
 * distinct from the inverter's own `load.energy.today` day counter — two
 * genuinely different numbers that a shared id would invite merging.
 */
export const OWNERSHIP = {
  // The registers, at the poll cadence. Nothing else can produce these: they
  // are readings, not conclusions.
  metrics: [
    "pv.total.power",
    "load.power",
    "grid.power",
    "battery.soc",
    "setting.battery.max_charge_current",
    "setting.solar_sell.max_power",
    // Day counters kept by the inverter itself.
    "production.today",
    "load.energy.today",
    "grid.energy.imported.today",
    "grid.energy.exported.today",
    "battery.energy.charged.today",
    "battery.energy.discharged.today",
  ],
  // The engine decided these. There is no register to read them off, and no
  // other feed can derive them without re-running the decision.
  automations: [
    "automation.target.current",
    "automation.threshold.power",
    "automation.surplus.energy",
    "automation.state",
    "automation.external.override",
    "automation.usable.energy",
    "automation.plan",
    "automation.decisions",
  ],
  // EVCC's own picture of the charger, pushed on MQTT traffic rather than our
  // poll — which is why its cadence stays separate from the metrics one.
  evcc: ["evcc.charge.power", "evcc.mode", "evcc.limit.soc"],
  // Integrated from stored rollups over the plant day. Deliberately NOT the
  // same number as the inverter's counters above.
  statistics: ["statistics.cost.today", "statistics.energy.today"],
} as const satisfies Record<OwningTopic, readonly string[]>;

/** A logical value the dashboard can show, named once across the whole app. */
export type LiveValueId = (typeof OWNERSHIP)[OwningTopic][number];

/** The values a given topic owns — the type that makes a cross-topic write unwritable. */
export type OwnedBy<T extends OwningTopic> = (typeof OWNERSHIP)[T][number];

/** Flat list of every id, for iteration and for the "exactly one owner" test. */
// fallow-ignore-next-line unused-export -- the vocabulary's size is what ownership.test.ts counts against; web test files aren't traced as consumers
export const LIVE_VALUE_IDS = Object.values(OWNERSHIP).flat() as readonly LiveValueId[];

/**
 * Invert the table, refusing a value that appears under two topics.
 *
 * The throw is the point. A silently last-wins map would let a future edit
 * reintroduce exactly the ambiguity the fallback bug grew out of, and it would
 * do so without a single test going red.
 */
// fallow-ignore-next-line unused-export -- exported so the duplicate-owner throw is provable on a table other than the real one
export function buildOwnerIndex(
  table: Partial<Record<OwningTopic, readonly string[]>>,
): Map<string, OwningTopic> {
  const index = new Map<string, OwningTopic>();
  for (const [topic, ids] of Object.entries(table) as [OwningTopic, readonly string[]][])
    for (const id of ids) {
      const owner = index.get(id);
      if (owner) throw new Error(`"${id}" is owned by both "${owner}" and "${topic}"`);
      index.set(id, topic);
    }
  return index;
}

const OWNER_INDEX = buildOwnerIndex(OWNERSHIP);

/** The one topic allowed to produce this value. Throws on an id outside the vocabulary. */
export function ownerOf(id: LiveValueId): OwningTopic {
  const owner = OWNER_INDEX.get(id);
  if (!owner) throw new Error(`"${id}" is not a known live value`);
  return owner;
}
