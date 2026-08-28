/**
 * RETIRING THE PROFILE-KEYED HOME ASSISTANT ENTITIES, ONCE.
 *
 * Until 2.0.0 every discovery announcement was published to
 * `<ha-prefix>/<component>/sunreye_<profileId>/<objectId>/config` with the RETAIN
 * flag set. `./mqtt.ts` now announces under the frozen slugs instead, which is the
 * fix — but a retained message does not go away because the publisher stopped
 * sending it. The old announcements are still on the broker, so Home Assistant
 * still creates the old entities on every restart, and they never receive a state
 * update again: permanent "unavailable" duplicates of every sensor, sitting in the
 * entity registry and in every autocomplete the operator uses.
 *
 * The MQTT verb for "remove this entity" is a ZERO-LENGTH RETAINED publish to the
 * same discovery topic: it deletes the retained message on the broker and tells HA
 * to drop the entity. That is what this module does.
 *
 * ## THIS IS DESTRUCTIVE AND IRREVERSIBLE, SO IT IS FENCED FOUR WAYS
 *
 *  1. **Once, from explicit state.** A row in `app_settings` under
 *     {@link LEGACY_RETIREMENT_KEY} records that the sweep ran. Not "on upgrade",
 *     not "on first connect" — the bridge reconnects on every broker restart and
 *     a reconnect storm would otherwise re-run it dozens of times, and a
 *     boot-flag-in-memory would re-run it on every restart forever.
 *  2. **Never while the migration discovery gate is holding.** That gate is held
 *     because the operator has not named their plant and device yet
 *     (`../migration/discovery-gate.ts`), so the NEW identity does not exist yet.
 *     Clearing then would delete the old entities and put nothing in their place.
 *     Re-checked after every await, because a decision taken before a round trip
 *     is stale by the time the publishes would go out.
 *  3. **Announce first.** The caller passes the entities it has JUST announced;
 *     with none, this does nothing. So the new entities always exist before the
 *     old ones go, and the operator is never left with no entities at all. The
 *     `keep` set makes that airtight in the degenerate case where a legacy topic
 *     and a new one are the same string.
 *  4. **Only topics this software owned.** Every topic is built from the LEGACY
 *     PATTERN with a profile id this install actually has — the active profile,
 *     plus the `profile_id` of every device row on the plant. Never a wildcard.
 *     `homeassistant/` is shared with every other MQTT integration on the box, and
 *     a `#` sweep there would delete a stranger's entities with no way back.
 *
 * The state row is written AFTER the publishes, deliberately. A crash in between
 * means the next boot repeats the sweep, and repeating it is harmless — clearing an
 * already-cleared retained topic is a no-op. The other order would record a
 * retirement that never happened.
 *
 * ## WHAT IT CANNOT REACH
 *
 * The object ids come from the CURRENT profile's manifest, because that is the only
 * metric catalog this process has. An install that ran 1.x under a profile it has
 * since uninstalled has announcements whose object ids nothing here can enumerate —
 * the profile that defined those metrics is gone. Those stay orphaned, and a
 * wildcard is not an acceptable way to find them. In practice the sets coincide:
 * the device row's `profile_id` is the active profile on every install that did not
 * change hardware, and a profile swap re-points that row rather than adding one.
 */

import { db } from "@SunReye/db";
import { type PlantDb, readDevices, readPlant } from "@SunReye/db/plant-repo";
import { type ZodType, z } from "zod";
import { readSetting, writeSetting } from "../settings/app-settings";

/** `app_settings` key recording that the legacy sweep has run. */
export const LEGACY_RETIREMENT_KEY = "mqtt.legacyEntitiesRetired";

/** What the state row records — a diagnosis aid as much as a latch. */
export interface LegacyRetirementState {
  /** ISO instant the sweep completed. */
  at: string;
  /** The legacy profile ids it swept, so the log can be reconstructed later. */
  profileIds: string[];
  /** How many topics it cleared. */
  topics: number;
}

/**
 * Deliberately permissive beyond `at`.
 *
 * `readSetting` `safeParse`s and falls back to the DEFAULT with no log line, so a
 * schema that rejected a row would report "never ran" for a sweep that HAS run —
 * and this sweep would then run again. Re-running is a broker no-op, so the
 * consequence is mild; the loose shape keeps it from happening at all when a later
 * release adds a field. Flat, never a discriminated union: see the note on
 * `../settings/merge-setting.ts`'s neighbours.
 */
const stateSchema = z.looseObject({
  at: z.string().min(1),
  profileIds: z.array(z.string()).default([]),
  topics: z.number().default(0),
});

/** One announcement the caller has just published, as its topic coordinates. */
export interface AnnouncedEntity {
  component: string;
  objectId: string;
}

/** The persistence and the profile-id lookup, injected so the rules are testable. */
export interface LegacyRetirementStore {
  /** The state row, or null when the sweep has never run. */
  readState(): Promise<LegacyRetirementState | null>;
  writeState(state: LegacyRetirementState): Promise<void>;
  /** Every profile id this install has published discovery under. */
  legacyProfileIds(): Promise<string[]>;
}

/** The minimal logger; kept small so any logger satisfies it. */
export interface RetirementLogger {
  info(template: string, values?: Record<string, unknown>): void;
  warn(template: string, values?: Record<string, unknown>): void;
}

export interface LegacyDiscoveryTopicsInput {
  discoveryPrefix: string;
  /** The legacy profile ids to sweep. Duplicates collapse. */
  profileIds: readonly string[];
  /** The entities just announced, which decide WHICH object ids existed. */
  announced: readonly AnnouncedEntity[];
  /** Topics the current announcement owns. Never cleared, whatever else says. */
  keep: ReadonlySet<string>;
}

/** The legacy discovery topic for one entity under one profile id. */
const legacyTopic = (prefix: string, profileId: string, e: AnnouncedEntity): string =>
  `${prefix}/${e.component}/sunreye_${profileId}/${e.objectId}/config`;

/**
 * Every legacy discovery topic this install is responsible for, deduplicated and
 * with the live announcement's own topics excluded.
 *
 * Pure, so the ONE thing that must never be wrong — which topics a destructive
 * publish goes to — is provable exhaustively without a broker.
 */
export function legacyDiscoveryTopics(input: LegacyDiscoveryTopicsInput): string[] {
  const seen = new Set<string>();
  for (const profileId of new Set(input.profileIds)) {
    for (const entity of input.announced) {
      const topic = legacyTopic(input.discoveryPrefix, profileId, entity);
      if (!input.keep.has(topic)) seen.add(topic);
    }
  }
  return [...seen];
}

export interface RetireLegacyInput extends Omit<LegacyDiscoveryTopicsInput, "profileIds"> {
  store: LegacyRetirementStore;
  /** Publish a zero-length RETAINED payload to one topic. */
  clear(topic: string): void;
  /** The migration discovery gate's reason, or null when it is open. */
  held(): string | null;
  logger: RetirementLogger;
}

/**
 * Run the sweep if — and only if — all four fences are clear. Returns the number
 * of topics cleared.
 *
 * Never throws. A database that cannot be read must not stop the bridge
 * announcing, and a sweep that did not run is the safe state: the old entities
 * linger, which is untidy, where a sweep that ran at the wrong moment deletes
 * entities that should exist.
 */
export async function retireLegacyEntities(input: RetireLegacyInput): Promise<number> {
  // Fence 3, first because it is free: nothing announced, nothing to replace.
  if (input.announced.length === 0) return 0;
  // Fence 2, before the round trip.
  if (input.held() !== null) return 0;

  let profileIds: string[];
  try {
    // Fence 1. Before the profile-id read, so a completed sweep costs one query.
    if (await input.store.readState()) return 0;
    profileIds = await input.store.legacyProfileIds();
  } catch (error) {
    input.logger.warn("could not decide whether legacy HA entities were retired: {error}", {
      error,
    });
    return 0;
  }

  // Fence 2 again. Both reads above are round trips, and the gate can have closed
  // across them; a stale "open" here would clear under a placeholder identity.
  if (input.held() !== null) return 0;
  if (profileIds.length === 0) return 0;

  // Fence 4: derived from the known legacy pattern, never a wildcard.
  const topics = legacyDiscoveryTopics({ ...input, profileIds });
  for (const topic of topics) input.clear(topic);

  const state: LegacyRetirementState = {
    at: new Date().toISOString(),
    profileIds,
    topics: topics.length,
  };
  try {
    // AFTER the clears: a crash in between repeats a no-op, the other order would
    // record a retirement that never happened.
    await input.store.writeState(state);
  } catch (error) {
    input.logger.warn("retired legacy HA entities but could not record it: {error}", { error });
    return topics.length;
  }

  if (topics.length > 0) {
    input.logger.info("retired {count} legacy Home Assistant entities announced under {profiles}", {
      count: topics.length,
      profiles: profileIds.join(", "),
    });
  }
  return topics.length;
}

/**
 * The `app_settings` accessors this store needs.
 *
 * Injected with a production default for the same reason `database` below is: the
 * two lookups here are the only IO in the module and BOTH are load-bearing — a
 * mis-read state row re-runs a destructive sweep, and a mis-read device list
 * decides which topics that sweep publishes to. Neither is provable while they are
 * hard-wired to the global client.
 */
export interface SettingsIo {
  read<T>(key: string, schema: ZodType<T>, fallback: T): Promise<T>;
  write<T>(key: string, value: T): Promise<void>;
}

/** The real `app_settings` pair. */
const dbSettingsIo: SettingsIo = { read: readSetting, write: writeSetting };

/**
 * The production store.
 *
 * The profile ids are the ACTIVE profile plus the `profile_id` of every device row
 * on the plant — retired devices INCLUDED, because a retired inverter's
 * announcements are exactly the orphans that need clearing. Read-only against the
 * spine: nothing here writes to a plant or a device, and in particular nothing
 * touches a frozen slug.
 */
export function dbLegacyRetirementStore(
  activeProfileId: string,
  database: PlantDb = db,
  settings: SettingsIo = dbSettingsIo,
): LegacyRetirementStore {
  return {
    // `.nullable()` so "no row" and "a row this schema rejects" both land on null
    // — "never ran" — the direction whose worst case is a repeat of an idempotent
    // no-op rather than a sweep silently skipped.
    readState: () => settings.read(LEGACY_RETIREMENT_KEY, stateSchema.nullable(), null),
    writeState: (state) => settings.write(LEGACY_RETIREMENT_KEY, state),
    legacyProfileIds: async () => {
      const plant = await readPlant(database);
      const ids = new Set<string>([activeProfileId]);
      if (plant) for (const d of await readDevices(database, plant.id)) ids.add(d.profileId);
      return [...ids].filter((id) => id.trim() !== "");
    },
  };
}
