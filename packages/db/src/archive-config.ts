/**
 * `config.json`: the plant graph, the settings, and the metric vocabulary —
 * expressed entirely by NAME.
 *
 * ## Not one integer refers to a row
 *
 * `plants.id`, `connections.id`, `devices.id` and `metric_keys.id` are all
 * `GENERATED ALWAYS AS IDENTITY` int2 surrogates (`./schema/plants.ts` explains
 * why `ALWAYS`: nothing may assign one, because an id supplied by hand could
 * rebind years of history to a different device). They therefore mean nothing
 * outside the database that issued them. So a device names its connection by
 * NAME, its battery is NESTED inside it, and the target database assigns its own
 * ids on import. `./archive.test.ts` and this module's suite both pin that no
 * `"id"` field leaks into the file.
 *
 * ## The 1.x side has no devices to read
 *
 * This is the awkward half of the export and there is no way around it. Before
 * 2.0.0 there was no plant entity and no device entity: `app_settings` held ONE
 * row with one host, one port and one unit id, and a reading's identity was
 * `inverter_id` — which `packages/inverter-core/src/driver.ts` stamped from
 * `this.profile.id`, the PROFILE id. That conflation is the headline bug 2.0.0
 * fixes.
 *
 * So {@link synthesiseSpine} invents the spine that 1.x never had: one
 * connection from the settings row, one device whose SLUG IS THE PROFILE ID.
 * That last choice is the load-bearing one — the readings exported from a 1.x
 * database carry `device_slug = inverter_id = profile.id`, so making the
 * synthesised device's slug the same string is what lets the importer resolve
 * them with no mapping table and no operator input.
 *
 * A Victron or Sigenergy install gains its second device on the IMPORT side, by
 * editing this graph before importing or by re-provisioning afterwards. The
 * export cannot invent a device it has no readings for.
 *
 * Pure: no database, no filesystem (`./archive-config.test.ts`).
 */

/** A Modbus endpoint, named rather than numbered. */
export interface ArchiveConnection {
  name: string;
  host: string;
  port: number;
  transport: string;
  timeoutMs: number;
  pollIntervalMs: number;
}

/** A battery pack, nested in the device that reports it — no `deviceId`. */
export interface ArchiveBattery {
  usableKwh: number;
  maxChargeW: number | null;
  minSoc: number;
  nominalV: number | null;
}

export interface ArchiveDevice {
  slug: string;
  name: string;
  profileId: string;
  serial: string | null;
  role: string;
  unitId: number;
  /** The {@link ArchiveConnection.name} this device is reached through, or null. */
  connection: string | null;
  /**
   * When this device was taken out of service, ISO 8601, or null for in service.
   *
   * Carried because `devices.retired_at` GATES POLLING. Without it an
   * export/import round trip returns a retired device IN SERVICE, and the
   * importing install starts dialling hardware its operator had deliberately
   * stopped talking to — silently, because nothing about a restored row says it
   * used to be retired.
   *
   * An ISO string rather than a Date: this crosses JSON, where a Date is not a
   * type. An archive written before the column existed simply omits the field
   * and parses as null, which is correct — retirement did not exist then, so no
   * device could have been retired.
   */
  retiredAt: string | null;
  battery: ArchiveBattery | null;
}

export interface ArchivePlant {
  name: string;
  slug: string;
  timeZone: string;
  latitude: number | null;
  longitude: number | null;
  label: string;
  arrays: unknown;
  tempCoefficient: number | null;
  systemLoss: number | null;
  maxOutputW: number | null;
  houseLoadW: number | null;
  smartMeterSince: string | null;
  biddingZone: string | null;
  tariffKey: string | null;
  connections: ArchiveConnection[];
  devices: ArchiveDevice[];
}

export interface ArchiveConfig {
  plant: ArchivePlant | null;
  appSettings: { key: string; value: unknown }[];
  installedProfiles: { id: string; source: string; version: string; data: unknown }[];
  customCharts: { id: string; name: string; data: unknown }[];
  /**
   * The metric vocabulary WITH its counter class.
   *
   * `is_counter` has to travel: the 2.0.0 aggregates put `counter_agg` on
   * counters and nothing else, a continuous aggregate cannot ask another table
   * what a row's class is, and getting it wrong is exactly the 1532x kWh error
   * this release exists to fix. It is also the one metric fact that outlives the
   * profile that declared it.
   */
  metricKeys: { key: string; isCounter: boolean }[];
  /**
   * Keys the source profile stores as CONFIGURATION rather than as a series.
   *
   * Resolved by the exporter (which has the profile) and written down, so the
   * importer needs no profile logic at all — and so it is never a `settings.%`
   * prefix match, which is one vendor's naming and silently stops applying on
   * the next (issue #150).
   */
  configKeys: string[];
  /** Things wrong with the file that are worth reporting but not fatal. */
  problems: string[];
}

export const emptyArchiveConfig = (): ArchiveConfig => ({
  plant: null,
  appSettings: [],
  installedProfiles: [],
  customCharts: [],
  metricKeys: [],
  configKeys: [],
  problems: [],
});

/**
 * A setting value, unwrapped once if it is a JSON string holding JSON.
 *
 * Real 1.x databases exist whose `app_settings.value` jsonb column holds a
 * *string* that itself contains the document — the committed addon-1.2.0 fixture
 * is one, every row of it. A reader that did not unwrap would see a string where
 * it expected `{ host }` and synthesise a device pointing nowhere, silently.
 *
 * Exactly ONE level, and only when the parse succeeds: a setting whose real value
 * is the string `"deye-sg05lp3"` must stay that string, and unwrapping in a loop
 * would eventually turn a legitimate stringified document into its contents.
 */
export function unwrapSetting(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/**
 * Field names whose VALUE is a per-instance secret.
 *
 * `app_settings` holds the MQTT password and a spot-price provider token in
 * plaintext — both of which the REST API deliberately REFUSES to return
 * (`maskMqttConfig`). An export that carried them would put, in a file designed to
 * be copied onto a USB stick and mailed, credentials the API will not even show
 * to an authenticated admin. On the Home Assistant add-on the export lands in
 * `/share`, which the Samba add-on serves to the whole LAN.
 *
 * Matched by FIELD NAME rather than by settings key, and that is the important
 * choice. A per-key allow-list ("redact `password` inside the `mqtt` row") is the
 * same shape as the `settings.%` prefix match issue #150 warns about: it is a
 * snapshot of today's schema and it silently stops applying the moment a new
 * provider adds a token. Matching the name applies to settings this build has
 * never heard of, which is exactly the ones a future field will be.
 */
const SECRET_FIELD = /password|passwd|secret|token|credential|api[_-]?key|private[_-]?key/i;

/** What a redacted field is replaced with — present, so its absence is legible. */
export const REDACTED = "__redacted__";

/**
 * Deep-copy `value`, replacing every secret-looking field with {@link REDACTED}.
 *
 * REPLACED rather than deleted: a settings document that lost its `password` key
 * entirely would import as "no password was ever set", which is
 * indistinguishable from "the password did not travel". A visible sentinel tells
 * the operator exactly which field to retype.
 */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    // A secret is redacted whatever it holds — including when it is an object, so
    // a nested credential bag cannot smuggle one through.
    out[key] = SECRET_FIELD.test(key) ? REDACTED : redactSecrets(inner);
  }
  return out;
}

/** Which field names {@link redactSecrets} treats as secret. Exposed for its test. */
export const isSecretField = (name: string): boolean => SECRET_FIELD.test(name);

/** A bare lower-case slug, or the literal fallback `device`. */
export function slugifyId(id: string): string {
  const slug = id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Never empty: an empty slug would break `devices_plant_slug_key` and, worse,
  // make every exported reading's `device_slug` unmatchable.
  return slug.length > 0 ? slug : "device";
}

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asOptionalNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

const asOptionalString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * The 1.x settings keys that have held the Modbus connection, newest first.
 *
 * `inverter` is what `./inverter-config.ts` declares (`INVERTER_KEY`) and what a
 * real 1.2.0 install holds. `inverter.connection` / `inverter.profile` is an
 * older split that the committed fixture still uses, and reading it costs two
 * lines — against an operator whose one shot at an export finds no inverter and
 * silently produces a device with no endpoint.
 */
const CONNECTION_KEYS = ["inverter", "inverter.connection"] as const;
const PROFILE_KEYS = ["inverter.profile", "profile"] as const;

/** The synthesised connection's label. Fixed, so re-exporting is idempotent. */
const SYNTHESISED_CONNECTION = "Modbus";

export interface SynthesiseInput {
  /** `app_settings`, already keyed. Values may be double-encoded. */
  settings: ReadonlyMap<string, unknown>;
  /**
   * The profile id, i.e. the 1.x `inverter_id` the readings are stamped with.
   * `null` to take it from the settings row.
   */
  profileId: string | null;
  /** Unused today; present so a caller can be explicit about what it is reading. */
  legacy?: boolean;
}

/**
 * The plant graph a 1.x database implies: one plant, one connection, one device.
 *
 * The device is synthesised even when there is NO HOST AT ALL. That is not
 * sloppiness: the device is what every exported reading resolves against, and an
 * imported history whose hardware is gone is a case `./schema/plants.ts`
 * explicitly allows for (`connectionId` is nullable precisely for it). Refusing
 * here would make such a history unimportable — the one outcome this whole
 * feature exists to prevent.
 */
export function synthesiseSpine(input: SynthesiseInput): ArchivePlant {
  const setting = (key: string) => unwrapSetting(input.settings.get(key));

  const connectionRow = CONNECTION_KEYS.map((key) => setting(key)).find(
    (value) => Object.keys(asRecord(value)).length > 0,
  );
  const connectionConfig = asRecord(connectionRow);

  const profileFromSettings = PROFILE_KEYS.map((key) => setting(key)).find(
    (value) => typeof value === "string" && value.length > 0,
  );
  const profileId =
    input.profileId ??
    (typeof profileFromSettings === "string" ? profileFromSettings : null) ??
    asOptionalString(connectionConfig.profile);
  if (profileId === null) {
    throw new Error(
      "archive: cannot export a 1.x database without a profile id — it is the identity every " +
        "reading is stamped with (app_settings.inverter.profile / inverter_profile), and " +
        "inventing one would produce readings that resolve to no device",
    );
  }

  const plantConfig = asRecord(setting("plant"));
  const host = asOptionalString(connectionConfig.host);
  const connections: ArchiveConnection[] = host
    ? [
        {
          name: SYNTHESISED_CONNECTION,
          host,
          port: asNumber(connectionConfig.port, 502),
          transport: asString(connectionConfig.transport, "tcp"),
          timeoutMs: asNumber(connectionConfig.timeoutMs, 2000),
          pollIntervalMs: asNumber(connectionConfig.pollIntervalMs, 1000),
        },
      ]
    : [];

  return {
    name: asString(plantConfig.name, "Imported plant"),
    slug: asString(plantConfig.slug, "plant"),
    // "auto" is the sentinel `./plant.ts`'s resolveServerZone already understands
    // — a legitimate value, not a missing one.
    timeZone: asString(plantConfig.timeZone, "auto"),
    latitude: asOptionalNumber(plantConfig.latitude),
    longitude: asOptionalNumber(plantConfig.longitude),
    label: asString(plantConfig.label, ""),
    arrays: Array.isArray(plantConfig.arrays) ? plantConfig.arrays : [],
    tempCoefficient: asOptionalNumber(plantConfig.tempCoefficient),
    systemLoss: asOptionalNumber(plantConfig.systemLoss),
    maxOutputW: asOptionalNumber(plantConfig.maxOutputW ?? plantConfig.peakPowerW),
    houseLoadW: asOptionalNumber(plantConfig.houseLoadW),
    smartMeterSince: asOptionalString(plantConfig.smartMeterSince),
    biddingZone: asOptionalString(plantConfig.biddingZone),
    tariffKey: asOptionalString(plantConfig.tariffKey),
    connections,
    devices: [
      {
        // THE SLUG IS THE PROFILE ID, verbatim where it already is a slug. This is
        // what makes the exported readings (stamped with the 1.x `inverter_id`,
        // which IS the profile id) resolve on import with no mapping table.
        slug: slugifyId(profileId),
        name: asString(connectionConfig.name, "Inverter"),
        profileId,
        serial: asOptionalString(connectionConfig.serial),
        role: "inverter",
        // A 1.x database has no retirement: the column did not exist.
        retiredAt: null,
        unitId: asNumber(connectionConfig.unitId, 0),
        connection: connections[0]?.name ?? null,
        battery: null,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Reading a config.json back.
//
// Tolerant on purpose, and the tolerance is asymmetric: a MALFORMED ENTRY is
// dropped and reported, while a MISSING SECTION is simply empty. An import that
// refused the whole file because one custom chart had no name would be worse
// than useless on the day it is needed, and every field dropped here is
// recoverable by hand. What is NOT tolerated is anything that could produce
// wrong history — those refusals live in `./archive.ts` (the manifest version,
// an unknown tier) and in `./archive-import.ts` (an unknown device or metric).
// ---------------------------------------------------------------------------

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function parseConnection(value: unknown): ArchiveConnection | null {
  const row = asRecord(value);
  const name = asOptionalString(row.name);
  const host = asOptionalString(row.host);
  if (name === null || host === null) return null;
  return {
    name,
    host,
    port: asNumber(row.port, 502),
    transport: asString(row.transport, "tcp"),
    timeoutMs: asNumber(row.timeoutMs, 2000),
    pollIntervalMs: asNumber(row.pollIntervalMs, 1000),
  };
}

function parseBattery(value: unknown): ArchiveBattery | null {
  const row = asRecord(value);
  const usableKwh = asOptionalNumber(row.usableKwh);
  if (usableKwh === null) return null;
  return {
    usableKwh,
    maxChargeW: asOptionalNumber(row.maxChargeW),
    minSoc: asNumber(row.minSoc, 10),
    nominalV: asOptionalNumber(row.nominalV),
  };
}

function parseDevice(value: unknown): ArchiveDevice | null {
  const row = asRecord(value);
  const slug = asOptionalString(row.slug);
  const profileId = asOptionalString(row.profileId);
  if (slug === null || profileId === null) return null;
  return {
    slug,
    name: asString(row.name, slug),
    profileId,
    serial: asOptionalString(row.serial),
    role: asString(row.role, "inverter"),
    unitId: asNumber(row.unitId, 0),
    connection: asOptionalString(row.connection),
    // `asOptionalString`, so a number or an object in this field becomes null
    // rather than a value the importer would bind. Falling back to "in service"
    // is the direction that cannot invent a retirement the operator never made;
    // the import's own rule (see `../archive-import.ts`) is what protects a
    // device that IS retired locally.
    retiredAt: asOptionalString(row.retiredAt),
    battery: parseBattery(row.battery),
  };
}

function parsePlant(value: unknown, problems: string[]): ArchivePlant | null {
  if (value === null || value === undefined) return null;
  const row = asRecord(value);
  const slug = asOptionalString(row.slug);
  if (slug === null) {
    problems.push("plant has no slug — the MQTT namespace cannot be derived, skipping the plant");
    return null;
  }
  const connections = list(row.connections)
    .map(parseConnection)
    .filter((c): c is ArchiveConnection => c !== null);
  const known = new Set(connections.map((c) => c.name));
  const devices = list(row.devices)
    .map(parseDevice)
    .filter((d): d is ArchiveDevice => d !== null)
    .map((device) => {
      if (device.connection !== null && !known.has(device.connection)) {
        // Reported and then NULLED rather than refused: an endpoint-less device
        // still resolves every reading it owns, which is the part that cannot be
        // reconstructed. A missing host can be retyped in thirty seconds.
        problems.push(
          `device ${JSON.stringify(device.slug)} names connection ` +
            `${JSON.stringify(device.connection)}, which the archive does not carry`,
        );
        return { ...device, connection: null };
      }
      return device;
    });
  return {
    name: asString(row.name, slug),
    slug,
    timeZone: asString(row.timeZone, "auto"),
    latitude: asOptionalNumber(row.latitude),
    longitude: asOptionalNumber(row.longitude),
    label: asString(row.label, ""),
    arrays: Array.isArray(row.arrays) ? row.arrays : [],
    tempCoefficient: asOptionalNumber(row.tempCoefficient),
    systemLoss: asOptionalNumber(row.systemLoss),
    maxOutputW: asOptionalNumber(row.maxOutputW),
    houseLoadW: asOptionalNumber(row.houseLoadW),
    smartMeterSince: asOptionalString(row.smartMeterSince),
    biddingZone: asOptionalString(row.biddingZone),
    tariffKey: asOptionalString(row.tariffKey),
    connections,
    devices,
  };
}

export function parseArchiveConfig(value: unknown): ArchiveConfig {
  const problems: string[] = [];
  const root = asRecord(value);
  return {
    plant: parsePlant(root.plant, problems),
    appSettings: list(root.appSettings)
      .map((entry) => {
        const row = asRecord(entry);
        const key = asOptionalString(row.key);
        // `"value" in row`, not truthiness: `false`, `0` and `null` are all
        // settings a user chose, and the last one is how a setting is cleared.
        return key !== null && "value" in row ? { key, value: row.value } : null;
      })
      .filter((entry): entry is { key: string; value: unknown } => entry !== null),
    installedProfiles: list(root.installedProfiles)
      .map((entry) => {
        const row = asRecord(entry);
        const id = asOptionalString(row.id);
        return id === null
          ? null
          : {
              id,
              source: asString(row.source, "unknown"),
              version: asString(row.version, "0.0.0"),
              data: row.data ?? {},
            };
      })
      .filter((entry) => entry !== null),
    customCharts: list(root.customCharts)
      .map((entry) => {
        const row = asRecord(entry);
        const id = asOptionalString(row.id);
        const name = asOptionalString(row.name);
        return id === null || name === null ? null : { id, name, data: row.data ?? {} };
      })
      .filter((entry) => entry !== null),
    metricKeys: list(root.metricKeys)
      .map((entry) => {
        const row = asRecord(entry);
        const key = asOptionalString(row.key);
        // `false` is the default that cannot corrupt a delta — the same choice
        // `./schema/plants.ts` makes for the column.
        return key === null ? null : { key, isCounter: row.isCounter === true };
      })
      .filter((entry): entry is { key: string; isCounter: boolean } => entry !== null),
    configKeys: list(root.configKeys).filter((key): key is string => typeof key === "string"),
    problems,
  };
}
