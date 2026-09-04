/**
 * The plant's own facts, as COLUMNS — and the translation between those columns
 * and the `weather` record every reader in the app is still typed on.
 *
 * WHAT MOVED, AND WHY IT HAD TO
 *
 * Until 2.0.0 the facts that describe a plant — where it is, what its PV
 * surfaces are, what it may export, how much load to assume, when its
 * smart-meter gateway arrived — lived inside ONE `app_settings` JSONB row shared
 * with the weather tile's own preferences. Two settings pages edited two halves
 * of that row, and a JSONB save is a read-modify-write of the whole document, so
 * saving a location wrote back whatever arrays that page had loaded. That is the
 * bug `apps/web/src/lib/components/settings/plant-fields-placement.test.ts` was
 * written to guard, and guarding it needed a rule about which form is allowed to
 * name which field — a rule no type could enforce.
 *
 * `packages/db/src/schema/plants.ts` gives each of those facts a column. An
 * `UPDATE` touches only the columns it names, so the clobber stops being a rule
 * and becomes an impossibility. This module is where that is made true:
 * {@link splitWeatherWrite} emits ONLY the columns the incoming patch actually
 * mentioned, so two concurrent saves of disjoint fields cannot overwrite each
 * other even though both went through a read-modify-write of the same record.
 *
 * WHY THE `WeatherConfig` SHAPE SURVIVES
 *
 * Around twenty call sites read `weather.forecast.*` — the forecast model, the
 * peak-shaving engine, the blocker list, three routes, the settings forms. The
 * shape is the app's vocabulary for "what is true about this plant", and
 * re-typing every one of them is a change with no test to justify it. So the
 * shape stays and only its SOURCE moves: {@link composeWeatherConfig} builds it
 * from the plant row, the derived battery, and the small remainder that is still
 * genuinely a preference (the switches and the provider).
 *
 * That remainder has ONE editor now — the weather form — so it is still written
 * as a whole record, which is safe for exactly the reason the plant half was not.
 *
 * Pure: no database, no client, no I/O. Every branch is unit-tested
 * (`plant-facts.test.ts`).
 */

import { z } from "zod";

import { type DeviceBattery, type PlantBattery, derivePlantBattery } from "./batteries";
import { type WeatherConfig, weatherConfigSchema } from "./weather";

/** One PV array, as the plant's `arrays` column stores it. */
export type PvArray = WeatherConfig["forecast"]["arrays"][number];

/**
 * The plant facts that are COLUMNS on `plants`.
 *
 * Deliberately not `Partial`: this is the whole set, and a reader gets every one
 * of them. Writers deal in `Partial<PlantFactColumns>` — see
 * {@link splitWeatherWrite}, where partiality is the entire point.
 */
export interface PlantFactColumns {
  latitude: number | null;
  longitude: number | null;
  label: string;
  arrays: PvArray[];
  tempCoefficient: number;
  systemLoss: number;
  maxOutputW: number | null;
  houseLoadW: number | null;
  smartMeterSince: string | null;
}

/** The preference remainder — what is still genuinely an `app_settings` record. */
export interface WeatherSettingsHalf {
  enabled: boolean;
  forecast: {
    enabled: boolean;
    provider: string;
    correction: WeatherConfig["forecast"]["correction"];
  };
}

/**
 * The `weather` record as every consumer reads it, sourced from the plant row.
 *
 * `stored` supplies only what is still a preference. Every plant fact comes from
 * `columns`, with NO fallback to the stored record: a fallback that preferred
 * the JSONB would make a column write invisible until the legacy key happened to
 * be absent, which is the worst of both storages. Carrying the 1.x values
 * forward is a one-time seeding job at provisioning
 * ({@link legacyColumnsFromWeatherRow}), not a read-time preference order.
 *
 * `battery` is the DERIVED plant battery (`./batteries.ts`), so every reader of
 * `forecast.battery` — the clipping model, the reserve floor, the blocker list —
 * goes through the capacity-weighted arithmetic by construction rather than by
 * remembering to.
 */
export function composeWeatherConfig(
  stored: WeatherSettingsHalf,
  columns: PlantFactColumns,
  battery: PlantBattery | null,
): WeatherConfig {
  return {
    enabled: stored.enabled,
    latitude: columns.latitude,
    longitude: columns.longitude,
    label: columns.label,
    forecast: {
      enabled: stored.forecast.enabled,
      provider: stored.forecast.provider,
      correction: stored.forecast.correction,
      arrays: columns.arrays,
      tempCoefficient: columns.tempCoefficient,
      systemLoss: columns.systemLoss,
      maxOutputW: columns.maxOutputW,
      houseLoadW: columns.houseLoadW,
      smartMeterSince: columns.smartMeterSince,
      battery,
    },
  };
}

/**
 * A battery instruction. `null` on the outer field means the patch did not
 * mention storage; `{ value: null }` means it said there is none.
 *
 * Two levels rather than one nullable because the two are different
 * instructions: "leave the pack alone" and "the plant has no pack" would
 * otherwise collapse, and a pack could never be removed.
 */
export interface BatteryWrite {
  value: DeviceBattery | null;
}

export interface WeatherWriteSplit {
  /** Only the columns the patch named. Everything else must not be UPDATEd. */
  columns: Partial<PlantFactColumns>;
  /** The pack instruction, or null when the patch was silent about storage. */
  battery: BatteryWrite | null;
  /** The preference half, whole — it has a single editor. */
  settings: WeatherSettingsHalf;
}

/** Whether a value is a plain object — the only thing worth looking into. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether `patch` NAMED `key` — present with anything but `undefined`.
 *
 * `undefined` is absent and `null` is a value, the same distinction
 * `./settings`' merge draws: a form omitting a key means "leave it alone" while
 * a form sending `null` means "clear it". Collapsing them would make the
 * smart-meter date impossible to unset.
 */
function named(patch: unknown, key: string): boolean {
  return isPlainObject(patch) && key in patch && patch[key] !== undefined;
}

/** Top-level plant facts, and the column each is. */
const TOP_LEVEL = ["latitude", "longitude", "label"] as const;
/** Plant facts nested under `forecast`, and the column each is. */
const FORECAST_LEVEL = [
  "arrays",
  "tempCoefficient",
  "systemLoss",
  "maxOutputW",
  "houseLoadW",
  "smartMeterSince",
] as const;

/**
 * Route one incoming patch into a column UPDATE, a pack write, and the
 * preference record.
 *
 * `patch` decides WHICH fields are written; `validated` decides what their
 * values are. That split is what keeps validation unchanged: the caller still
 * merges the patch onto the current record and runs the full
 * `weatherConfigSchema` over it, so a tilt of 400 is rejected exactly as before
 * — but the write that follows names only the fields the operator's form
 * actually sent.
 */
export function splitWeatherWrite(patch: unknown, validated: WeatherConfig): WeatherWriteSplit {
  const columns: Partial<PlantFactColumns> = {};
  for (const key of TOP_LEVEL) {
    if (named(patch, key)) columns[key] = validated[key] as never;
  }
  const forecastPatch = isPlainObject(patch) ? patch.forecast : undefined;
  for (const key of FORECAST_LEVEL) {
    if (named(forecastPatch, key)) columns[key] = validated.forecast[key] as never;
  }

  const battery = named(forecastPatch, "battery")
    ? { value: validated.forecast.battery ?? null }
    : null;

  return {
    columns,
    battery,
    settings: {
      enabled: validated.enabled,
      forecast: {
        enabled: validated.forecast.enabled,
        provider: validated.forecast.provider,
        correction: validated.forecast.correction,
      },
    },
  };
}

/** A finite number, or undefined — so a stringified or absent field is skipped. */
function maybeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * A reader: one stored value in, a usable value or `undefined` out.
 *
 * The mining below is a TABLE of these rather than a run of `if`s, and that is
 * not only tidiness: each field's rule is "the same bounds
 * `weatherConfigSchema` states", and side-by-side readers are the form in which
 * a drifted bound is visible. Mining a value the schema would refuse would seed
 * a column the forms then cannot save.
 */
type Reader<T> = (value: unknown) => T | undefined;

/** A number within an inclusive range. */
const between =
  (min: number, max: number): Reader<number> =>
  (value) => {
    const n = maybeNumber(value);
    return n !== undefined && n >= min && n <= max ? n : undefined;
  };

/** A number strictly above zero and no greater than `max`. */
const positive =
  (max: number): Reader<number> =>
  (value) => {
    const n = maybeNumber(value);
    return n !== undefined && n > 0 && n <= max ? n : undefined;
  };

/** A string no longer than `max`. */
const upTo =
  (max: number): Reader<string> =>
  (value) =>
    typeof value === "string" && value.length <= max ? value : undefined;

/** Any string at all — a date field's format is the form's business, not this. */
const anyString: Reader<string> = (value) => (typeof value === "string" ? value : undefined);

/** A non-empty string no longer than `max` — see `pvArraySchema.deviceSlug`. */
const slug =
  (max: number): Reader<string> =>
  (value) =>
    typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;

/**
 * The three OPTIONAL fields of a PV array, and the reader each is.
 *
 * Split out from the three required ones because they fail differently: a
 * missing or out-of-bounds `kwp` means the entry describes no surface, while a
 * missing or out-of-bounds override means only that nobody stated one — and the
 * plant column, which is where the value came from before overrides existed, is
 * the answer. Folding them into the all-or-nothing check would let one typo'd
 * datasheet number delete a whole string from the plant's capacity.
 */
const ARRAY_OVERRIDES = {
  deviceSlug: slug(120),
  tempCoefficient: between(-2, 0),
  systemLoss: between(0, 90),
} as const satisfies { [K in keyof PvArrayOverrides]-?: Reader<NonNullable<PvArrayOverrides[K]>> };

/** Just the optional half of {@link PvArray}, so the reader table can be typed. */
type PvArrayOverrides = Omit<PvArray, "kwp" | "tilt" | "azimuth">;

/**
 * One PV array, or undefined when any of its three REQUIRED numbers is unusable.
 *
 * The overrides are copied only when present and in bounds, and an absent one is
 * left off the object entirely rather than written as `undefined`: this value is
 * round-tripped back into JSONB, and "the key is not there" is the same thing the
 * schema means by optional. `undefined` would survive a `??` identically today
 * and read as a stated field in a `Object.keys` or a diff tomorrow.
 */
function maybeArray(entry: unknown): PvArray | undefined {
  if (!isPlainObject(entry)) return undefined;
  const kwp = positive(100_000)(entry.kwp);
  const tilt = between(0, 90)(entry.tilt);
  const azimuth = between(-180, 180)(entry.azimuth);
  if (kwp === undefined || tilt === undefined || azimuth === undefined) return undefined;
  const array: PvArray = { kwp, tilt, azimuth };
  for (const [key, read] of Object.entries(ARRAY_OVERRIDES)) {
    const value = read(entry[key]);
    if (value !== undefined) Object.assign(array, { [key]: value });
  }
  return array;
}

/**
 * A well-formed PV array list, or undefined when ANY entry is not one.
 *
 * All-or-nothing rather than filtering: the surfaces are read together (their
 * kWp sums to the plant's capacity), so a silently shortened list would model a
 * smaller plant than the one that exists and understate every forecast.
 */
/**
 * The stored `arrays` JSONB of a device row as a list, or `[]` when it holds
 * anything a reader could not index into. The device side of
 * {@link columnsFromPlantRow}'s same rule; one spelling for both tables.
 */
export function deviceArraysFrom(value: unknown): PvArray[] {
  return maybeArrays(value) ?? [];
}

const maybeArrays: Reader<PvArray[]> = (value) => {
  if (!Array.isArray(value)) return undefined;
  const out: PvArray[] = [];
  for (const entry of value) {
    const parsed = maybeArray(entry);
    if (parsed === undefined) return undefined;
    out.push(parsed);
  }
  return out;
};

/** What a 1.x `weather` row has to say about the plant, plus its pack. */
export type LegacyPlantFacts = Partial<PlantFactColumns> & { battery?: DeviceBattery };

/** The plant facts stored at the ROOT of the 1.x weather record. */
const ROOT_READERS = {
  latitude: between(-90, 90),
  longitude: between(-180, 180),
  label: upTo(120),
} as const;

/** The plant facts stored under its `forecast` key. */
const FORECAST_READERS = {
  arrays: maybeArrays,
  tempCoefficient: between(-2, 0),
  systemLoss: between(0, 90),
  maxOutputW: positive(10_000_000),
  houseLoadW: between(0, 10_000_000),
  smartMeterSince: anyString,
} as const;

/** Apply a reader table to one source object, writing only what it accepted. */
function mine(
  source: Record<string, unknown>,
  readers: Record<string, Reader<unknown>>,
  out: LegacyPlantFacts,
): void {
  for (const [key, read] of Object.entries(readers)) {
    const value = read(source[key]);
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
}

/**
 * Mine a RAW `app_settings.weather` value for the facts the columns now own.
 *
 * Raw, not through `readSetting`. That accessor `safeParse`s and falls back to
 * the DEFAULT with no log line, so a stored blob the current schema would reject
 * — one array with an out-of-range tilt is enough — comes back looking exactly
 * like "nothing was ever configured". Seeding from that would discard the
 * coordinates, the export cap and the pack of an install that had all three.
 *
 * So every field is taken on its own terms: a usable value is carried, an
 * unusable one is simply absent from the result and the column keeps its own
 * default. An absent row yields nothing to seed — which is different from
 * seeding defaults, because a seeded default is indistinguishable from a value
 * the operator typed.
 */
export function legacyColumnsFromWeatherRow(row: unknown): LegacyPlantFacts {
  if (!isPlainObject(row)) return {};
  const out: LegacyPlantFacts = {};
  mine(row, ROOT_READERS, out);
  const forecast = isPlainObject(row.forecast) ? row.forecast : {};
  mine(forecast, FORECAST_READERS, out);
  const battery = legacyBattery(forecast.battery);
  if (battery !== undefined) out.battery = battery;
  return out;
}

/**
 * The pack a 1.x forecast record describes, or undefined when it describes none.
 *
 * `usableKwh` is what makes the block exist at all — the plant form's own rule —
 * so a record with a reserve and no capacity is not a pack. `minSoc` keeps the
 * schema's default rather than being dropped, because the forms have always
 * shown 10 there; `nominalV` does NOT default, because a default would shadow
 * whatever the automations page set and silently rescale every commanded charge
 * current (see `./batteries.ts`'s `resolveNominalV`).
 */
function legacyBattery(value: unknown): DeviceBattery | undefined {
  if (!isPlainObject(value)) return undefined;
  const usableKwh = positive(10_000)(value.usableKwh);
  if (usableKwh === undefined) return undefined;
  return {
    usableKwh,
    maxChargeW: positive(10_000_000)(value.maxChargeW) ?? null,
    minSoc: between(0, 100)(value.minSoc) ?? 10,
    nominalV: positive(1_500)(value.nominalV) ?? null,
  };
}

/** The plant columns as {@link composeWeatherConfig} needs them, from a plant row. */
export function columnsFromPlantRow(row: {
  latitude: number | null;
  longitude: number | null;
  label: string;
  arrays: unknown;
  tempCoefficient: number;
  systemLoss: number;
  maxOutputW: number | null;
  houseLoadW: number | null;
  smartMeterSince: string | null;
}): PlantFactColumns {
  return {
    latitude: row.latitude,
    longitude: row.longitude,
    label: row.label,
    // JSONB comes back as whatever was stored. A row written by hand (a restore,
    // an import) can hold anything, and the readers index into these entries.
    arrays: maybeArrays(row.arrays) ?? [],
    tempCoefficient: row.tempCoefficient,
    systemLoss: row.systemLoss,
    maxOutputW: row.maxOutputW,
    houseLoadW: row.houseLoadW,
    smartMeterSince: row.smartMeterSince,
  };
}

/** The plant battery derived from a plant's pack rows, or null when it has none. */
export function plantBatteryFrom(packs: readonly DeviceBattery[]): PlantBattery | null {
  return derivePlantBattery(packs);
}

/**
 * The `app_settings.weather` row, as it is stored FROM NOW ON.
 *
 * Only the switches, the provider and the correction flag — the fields that are
 * genuinely preferences and are edited from exactly one form. Everything else the
 * 1.x record carried is a column on `plants` now, and this schema deliberately
 * does not restate those fields: a Zod object drops unknown keys, so the first
 * save after the upgrade REMOVES the stale copy from the row rather than leaving
 * two versions of the plant's coordinates for a later reader to choose between.
 *
 * That is only safe because the columns are seeded from the raw row BEFORE
 * anything can write it — `apps/server/src/inverter/provision.ts`'s
 * `provisionPlantRow`, which the settings accessor calls on its first read.
 *
 * Whole-record writes are also only safe for the same reason the plant half's
 * were not: this record has a single editor. The clobber was two settings pages
 * read-modify-writing one JSONB document; one page cannot race itself.
 */
const forecastShape = weatherConfigSchema.shape.forecast.unwrap().shape;

/** The forecast's own preference half — the switch, the provider, the correction. */
const forecastPrefsSchema = z.object({
  enabled: forecastShape.enabled,
  provider: forecastShape.provider,
  correction: forecastShape.correction,
});

export const weatherPrefsSchema = z.object({
  enabled: weatherConfigSchema.shape.enabled,
  // The default is PARSED, not `{}`: a zod default is used verbatim, so
  // `.default({})` would hand every reader of an absent row a forecast object
  // with no fields at all — and `weather.ts` has the same construction for the
  // same reason.
  forecast: forecastPrefsSchema.default(forecastPrefsSchema.parse({})),
});
export type WeatherPrefs = z.infer<typeof weatherPrefsSchema>;

export const defaultWeatherPrefs: WeatherPrefs = weatherPrefsSchema.parse({});

/**
 * The `app_settings.spot-prices` row, as it is stored from now on.
 *
 * The bidding ZONE moved to `plants.bidding_zone`: it is a fact about where the
 * plant settles, not a preference about the feed, and the plant is what a second
 * one of them would belong to. `enabled` and `provider` stay — they describe the
 * fetch job.
 */
export const spotPricePrefsSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.string().min(1).default("energy-charts"),
});
export type SpotPricePrefs = z.infer<typeof spotPricePrefsSchema>;

export const defaultSpotPricePrefs: SpotPricePrefs = spotPricePrefsSchema.parse({});
