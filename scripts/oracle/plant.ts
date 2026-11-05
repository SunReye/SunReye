/**
 * Oracle group 7, database-free half: a plant of several devices folded by role, as the 2.x code
 * does it. Each case is a device roster, the metric roles, every device's latest live sample and
 * every device's recent-history backfill. The 2.x code decides the rest: the member sets
 * (`plantMembers`), `GET /api/sources` (`listSources`), the live fold the `plant` topic publishes
 * (`foldLiveSamples` over the live members, as `startPlantLive` calls it) and the recent-history fold
 * (`foldRecentBackfills` over the history members, as `queryRecentBuckets` calls it).
 *
 * No device has a battery, so every member weighs 1: the core keeps no battery capacity.
 */
import type { DeviceRecord } from "@SunReye/db/plant-repo";
import { ROLE_CATALOG, plantAggregateOf } from "@SunReye/inverter-core";

import { listSources } from "../../apps/server/src/devices/plant-sources";
import type { RecentBackfill } from "../../apps/server/src/shared/history";
import {
  type LiveMember,
  foldLiveSamples,
  foldRecentBackfills,
} from "../../apps/server/src/shared/plant-fold";
import { aggregateOfMetric } from "../../apps/server/src/shared/plant-read";
import { plantMembers } from "../../apps/server/src/shared/plant-source";
import { type CorpusFiles, ndjson } from "./corpus";

/** 2026-03-01T00:02:30.000Z: the instant every live fold runs at. */
const NOW_MS = 1_772_323_350_000;
const STALE_AFTER_MS = 5 * 60 * 1000;
/** What the core answers for the plant's zone while it keeps none: its buckets are UTC. */
const TIME_ZONE = "UTC";

interface PlantDevice {
  slug: string;
  name: string;
  profileId: string;
  role: "inverter" | "meter" | "charger" | "controller";
  retiredAt: string | null;
}

type LiveSample = { time: string; metrics: Record<string, number> } | null;

interface PlantCase {
  case: string;
  devices: PlantDevice[];
  /** Metric key to role, as the plant's profile maps it. */
  roles: Record<string, string>;
  live: { now: string; staleAfterMs: number; samples: Record<string, LiveSample> };
  /** Every device's own `/api/history/recent` answer, step 1. */
  recent: Record<string, RecentBackfill>;
}

/** The roles of `deye-sg05lp3` for the keys the cases read. */
const ROLES = {
  "dc.total_power": "pv.total.power",
  "battery.soc": "battery.soc",
  "battery.power": "battery.power",
  "ac.l1.voltage": "grid.phase.voltage",
  total_energy: "production.total",
};

const at = (offsetMs: number): string => new Date(NOW_MS + offsetMs).toISOString();
const T0 = NOW_MS - 10_000;
const series = (o: number[], v: number[]) => ({ o, v });
const device = (
  slug: string,
  name: string,
  role: PlantDevice["role"] = "inverter",
  retiredAt: string | null = null,
): PlantDevice => ({ slug, name, profileId: "deye-sg05lp3", role, retiredAt });

const PLANT_CASES: PlantCase[] = [
  {
    // Both report PV and production; only the roof has a battery; the voltage is each machine's own.
    case: "overlapping-roles",
    devices: [device("1", "Roof"), device("2", "Garage")],
    roles: ROLES,
    live: {
      now: at(0),
      staleAfterMs: STALE_AFTER_MS,
      samples: {
        "1": {
          time: at(-1000),
          metrics: {
            "dc.total_power": 3000,
            "battery.soc": 80,
            "battery.power": -1200,
            "ac.l1.voltage": 230.1,
            total_energy: 1520.4,
          },
        },
        "2": {
          time: at(-1500),
          metrics: { "dc.total_power": 1500.5, "ac.l1.voltage": 229.4, total_energy: 310.2 },
        },
      },
    },
    recent: {
      "1": {
        t0: T0,
        step: 1,
        metrics: {
          "dc.total_power": series([0, 1, 2, 5], [3000, 3010, 2990, 3005]),
          "battery.soc": series([0, 3], [80, 81]),
          "ac.l1.voltage": series([0], [230]),
          total_energy: series([0, 6], [1520.3, 1520.4]),
        },
      },
      "2": {
        t0: T0 + 2000,
        step: 1,
        metrics: {
          "dc.total_power": series([0, 1, 4], [1500, 0, 1500.5]),
          "ac.l1.voltage": series([0], [229.4]),
          total_energy: series([0], [310.2]),
        },
      },
    },
  },
  {
    // The garage stopped answering five minutes and a millisecond ago.
    case: "stale-member",
    devices: [device("1", "Roof"), device("2", "Garage")],
    roles: ROLES,
    live: {
      now: at(0),
      staleAfterMs: STALE_AFTER_MS,
      samples: {
        "1": { time: at(-2000), metrics: { "dc.total_power": 2500, "battery.soc": 55 } },
        "2": {
          time: at(-STALE_AFTER_MS - 1),
          metrics: { "dc.total_power": 900, "battery.soc": 20 },
        },
      },
    },
    recent: {
      "1": {
        t0: T0,
        step: 1,
        metrics: {
          "dc.total_power": series([0, 9], [2400, 2500]),
          "battery.soc": series([0], [55]),
        },
      },
      "2": { t0: 0, step: 1, metrics: {} },
    },
  },
  {
    // The garage was retired ten seconds ago: its history stays in the plant, its live sample does not.
    // The meter is never a member.
    case: "retired-member",
    devices: [
      device("1", "Roof"),
      device("2", "Garage", "inverter", "2026-03-01T00:02:20.000Z"),
      device("3", "Grid meter", "meter"),
    ],
    roles: ROLES,
    live: {
      now: at(0),
      staleAfterMs: STALE_AFTER_MS,
      samples: {
        "1": { time: at(-1000), metrics: { "dc.total_power": 2000, "ac.l1.voltage": 231 } },
        "2": { time: at(-11_000), metrics: { "dc.total_power": 700, "ac.l1.voltage": 228 } },
        "3": { time: at(-1000), metrics: { "dc.total_power": 50 } },
      },
    },
    recent: {
      "1": {
        t0: T0,
        step: 1,
        metrics: { "dc.total_power": series([0, 4, 8], [1900, 1950, 2000]) },
      },
      "2": {
        t0: T0 - 3000,
        step: 1,
        metrics: { "dc.total_power": series([0, 2], [700, 650]) },
      },
      "3": { t0: T0, step: 1, metrics: { "dc.total_power": series([0], [50]) } },
    },
  },
  {
    // A controller reports the plant's total, so it is the whole member set; a plant of one member is
    // that member, its voltage included.
    case: "controller-and-meter",
    devices: [
      device("1", "Hybrid controller", "controller"),
      device("2", "Roof"),
      device("3", "Grid meter", "meter"),
    ],
    roles: ROLES,
    live: {
      now: at(0),
      staleAfterMs: STALE_AFTER_MS,
      samples: {
        "1": { time: at(-500), metrics: { "dc.total_power": 4200, "ac.l1.voltage": 230.5 } },
        "2": { time: at(-500), metrics: { "dc.total_power": 4100, "ac.l1.voltage": 230.2 } },
        "3": { time: at(-500), metrics: { "dc.total_power": 10 } },
      },
    },
    recent: {
      "1": {
        t0: T0,
        step: 1,
        metrics: {
          "dc.total_power": series([0, 1], [4100, 4200]),
          "ac.l1.voltage": series([1], [230.5]),
        },
      },
      "2": { t0: T0, step: 1, metrics: { "dc.total_power": series([0], [4000]) } },
      "3": { t0: T0, step: 1, metrics: { "dc.total_power": series([0], [10]) } },
    },
  },
  {
    // Both report a battery SOC and are fresh: the plant SOC is their mean at weight 1, not their sum.
    case: "two-batteries",
    devices: [device("1", "Roof"), device("2", "Garage")],
    roles: ROLES,
    live: {
      now: at(0),
      staleAfterMs: STALE_AFTER_MS,
      samples: {
        "1": { time: at(-1000), metrics: { "battery.soc": 80, "battery.power": -1000 } },
        "2": { time: at(-2000), metrics: { "battery.soc": 40, "battery.power": 500 } },
      },
    },
    recent: {
      "1": {
        t0: T0,
        step: 1,
        metrics: {
          "battery.soc": series([0, 4], [80, 81]),
          "battery.power": series([0], [-1000]),
        },
      },
      "2": {
        t0: T0 + 2000,
        step: 1,
        metrics: {
          "battery.soc": series([0, 3], [40, 30]),
          "battery.power": series([0], [500]),
        },
      },
    },
  },
];

/** A case's devices as the 2.x roster holds them; ids are the slugs. */
function deviceRecords(c: { devices: PlantDevice[] }): DeviceRecord[] {
  return c.devices.map((d) => ({
    id: Number(d.slug),
    slug: d.slug,
    name: d.name,
    profileId: d.profileId,
    role: d.role,
    unitId: 1,
    connectionId: 1,
    params: {},
    arrays: [],
    tempCoefficient: -0.004,
    systemLoss: 0.14,
    retiredAt: d.retiredAt === null ? null : new Date(d.retiredAt),
  }));
}

function memberRows(c: PlantCase) {
  return deviceRecords(c).map((d) => ({ ...d, batteryKwh: null }));
}

async function plantCase(c: PlantCase) {
  const rows = memberRows(c);
  const history = plantMembers(rows);
  const live = plantMembers(rows, { live: true });
  const aggregateOf = aggregateOfMetric(
    new Map(Object.entries(c.roles).map(([key, role]) => [key, { key, role }])) as never,
  );
  const liveMembers: LiveMember[] = live.map((m) => ({
    slug: m.slug,
    weight: m.weight,
    sample: c.live.samples[m.slug] ?? null,
  }));
  const sources = await listSources({
    readPlant: async () => ({ id: 1 }) as never,
    readPlantTimeZone: async () => TIME_ZONE,
    readDevices: async () => deviceRecords(c),
    readPlantBatteries: async () => [],
  });
  return {
    ...c,
    members: { history: history.map((m) => m.slug), live: live.map((m) => m.slug) },
    sources,
    plant: {
      live: foldLiveSamples(liveMembers, {
        nowMs: Date.parse(c.live.now),
        staleAfterMs: c.live.staleAfterMs,
        aggregateOf,
      }),
      recent: foldRecentBackfills(
        history.map((m) => ({ weight: m.weight, backfill: c.recent[m.slug]! })),
        aggregateOf,
      ),
    },
  };
}

/** Build `role-aggregates.ndjson` and `plant.ndjson`. */
export async function buildPlantCorpus(): Promise<CorpusFiles> {
  return {
    "role-aggregates.ndjson": ndjson([
      Object.fromEntries(Object.keys(ROLE_CATALOG).map((role) => [role, plantAggregateOf(role)])),
    ]),
    "plant.ndjson": ndjson(await Promise.all(PLANT_CASES.map(plantCase))),
  };
}
