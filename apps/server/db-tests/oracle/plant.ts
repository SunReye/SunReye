/**
 * Oracle group 7, database half: a plant's minute rollups folded across its members, from the 2.x read
 * path against TimescaleDB. Each case is a device roster, the metric roles and every device's readings.
 * The 2.x code decides the rest: the history member set (`plantMembers`, retired devices included), the
 * plant read per metric (`plantFoldFor`: a per-device role is refused, a plant of one member is read as
 * that device) and the minute buckets `queryRollup` answers for it. Members weigh 1: no battery.
 */
import { sql } from "drizzle-orm";

import type { Db } from "./files";
import { ndjson } from "./files";

type Reading = [string, number];
type Role = "inverter" | "meter" | "charger" | "controller";

interface Device {
  slug: string;
  name: string;
  role: Role;
  retiredAt: string | null;
  /** Metric key to readings. */
  readings: Record<string, Reading[]>;
}

export interface PlantRollupCase {
  case: string;
  window: { from: string; to: string };
  /** Metric key to role, as the plant's profile maps it. */
  roles: Record<string, string>;
  devices: Device[];
}

const ROLES = {
  "dc.total_power": "pv.total.power",
  "battery.soc": "battery.soc",
  "ac.l1.voltage": "grid.phase.voltage",
};

const WINDOW = { from: "2026-02-28T23:50:00.000Z", to: "2026-02-28T23:56:00.000Z" };
const at = (minute: number, second = 0): string =>
  new Date(Date.parse(WINDOW.from) + minute * 60_000 + second * 1000).toISOString();
const device = (
  slug: string,
  name: string,
  readings: Device["readings"],
  role: Role = "inverter",
  retiredAt: string | null = null,
): Device => ({ slug, name, role, retiredAt, readings });

export const PLANT_ROLLUP_CASES: PlantRollupCase[] = [
  {
    // Both report PV, the garage from minute 2 on; only the roof has a battery; the voltage is refused.
    case: "overlapping-roles",
    window: WINDOW,
    roles: ROLES,
    devices: [
      device("1", "Roof", {
        "dc.total_power": [
          [at(0), 3000],
          [at(1), 3100],
          [at(2, 30), 2900],
          [at(4), 3050],
        ],
        "battery.soc": [
          [at(0), 80],
          [at(3), 82],
        ],
        "ac.l1.voltage": [
          [at(0), 230],
          [at(2), 231],
        ],
      }),
      device("2", "Garage", {
        "dc.total_power": [
          [at(2), 1500],
          [at(3, 20), 0],
          [at(4), 1400],
        ],
        "ac.l1.voltage": [[at(2), 229]],
      }),
    ],
  },
  {
    // The garage was retired at minute 3: its readings before stay in the plant. The meter is never a member.
    case: "retired-member",
    window: WINDOW,
    roles: ROLES,
    devices: [
      device("1", "Roof", {
        "dc.total_power": [
          [at(0), 2000],
          [at(2), 2100],
          [at(4), 2200],
        ],
      }),
      device(
        "2",
        "Garage",
        {
          "dc.total_power": [
            [at(0), 700],
            [at(1, 30), 650],
          ],
        },
        "inverter",
        at(3),
      ),
      device("3", "Grid meter", { "dc.total_power": [[at(0), 50]] }, "meter"),
    ],
  },
  {
    // A controller is the whole member set; a plant of one member is that device, its voltage included.
    case: "controller-and-meter",
    window: WINDOW,
    roles: ROLES,
    devices: [
      device(
        "1",
        "Hybrid controller",
        {
          "dc.total_power": [
            [at(0), 4100],
            [at(1), 4200],
          ],
          "ac.l1.voltage": [[at(0), 230.5]],
        },
        "controller",
      ),
      device("2", "Roof", { "dc.total_power": [[at(0), 4000]] }),
      device("3", "Grid meter", { "dc.total_power": [[at(0), 10]] }, "meter"),
    ],
  },
  {
    // Both report a battery SOC: the plant SOC is their mean at weight 1, with the members' extremes.
    case: "two-batteries",
    window: WINDOW,
    roles: ROLES,
    devices: [
      device("1", "Roof", {
        "battery.soc": [
          [at(0), 80],
          [at(0, 30), 84],
          [at(2), 82],
        ],
      }),
      device("2", "Garage", {
        "battery.soc": [
          [at(0), 40],
          [at(1), 30],
          [at(2, 30), 36],
        ],
      }),
    ],
  },
];

const dbSlug = (c: PlantRollupCase, d: Device): string => `oracle-plant-${c.case}-${d.slug}`;

async function idOf(db: Db, query: ReturnType<typeof sql>): Promise<number> {
  const row = await db.execute<{ id: number }>(query);
  return Number((row.rows[0] as { id: number }).id);
}

/** Insert one case's devices and readings, and materialise the minute tier over its window. */
async function seed(db: Db, c: PlantRollupCase): Promise<Map<string, number>> {
  await db.execute(sql`
    insert into plants (name, slug, time_zone) values ('oracle', 'oracle', 'UTC')
    on conflict (slug) do nothing`);
  const ids = new Map<string, number>();
  for (const d of c.devices) {
    const id = await idOf(
      db,
      sql`insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
          select id, null, 1, ${dbSlug(c, d)}, ${dbSlug(c, d)}, 'oracle-profile', ${d.role}
          from plants where slug = 'oracle'
          returning id`,
    );
    ids.set(d.slug, id);
    for (const [key, readings] of Object.entries(d.readings)) {
      const metricId = await idOf(
        db,
        sql`insert into metric_keys (key, is_counter) values (${key}, false)
            on conflict (key) do update set key = excluded.key
            returning id`,
      );
      for (const [time, value] of readings) {
        await db.execute(sql`
          insert into metrics_raw (time, value, dur_ms, device_id, metric_id)
          values (${time}::timestamptz, ${value}, 1000, ${id}, ${metricId})`);
      }
    }
  }
  await db.execute(sql`call refresh_continuous_aggregate(
    'minute_rollups', ${WINDOW.from}::timestamptz - interval '1 day', ${WINDOW.to}::timestamptz + interval '1 day')`);
  return ids;
}

async function rollupLine(db: Db, c: PlantRollupCase) {
  const { queryRollup } = await import("../../src/shared/history");
  const { aggregateOfMetric, isRefusal, plantFoldFor } =
    await import("../../src/shared/plant-read");
  const { plantMembers } = await import("../../src/shared/plant-source");
  const ids = await seed(db, c);
  const rows = c.devices.map((d) => ({
    id: ids.get(d.slug)!,
    slug: dbSlug(c, d),
    name: d.name,
    profileId: "oracle-profile",
    role: d.role,
    retiredAt: d.retiredAt === null ? null : new Date(d.retiredAt),
    batteryKwh: null,
  }));
  const members = plantMembers(rows);
  const aggregateOf = aggregateOfMetric(
    new Map(Object.entries(c.roles).map(([key, role]) => [key, { key, role }])) as never,
  );
  const plant: Record<string, unknown> = {};
  for (const metric of Object.keys(c.roles)) {
    const args = plantFoldFor({ kind: "plant" }, members, metric, aggregateOf);
    plant[metric] = isRefusal(args)
      ? { refused: args.error }
      : await queryRollup({
          metric,
          bucket: "minute",
          from: new Date(c.window.from),
          to: new Date(c.window.to),
          limit: 100_000,
          ...args,
        });
  }
  const bySlug = new Map(rows.map((r, i) => [r.slug, c.devices[i]!.slug]));
  return { ...c, members: members.map((m) => bySlug.get(m.slug)), minute: plant };
}

/** Build `plant-rollups.ndjson`. */
export async function buildPlantRollups(db: Db): Promise<Record<string, string>> {
  const lines = [];
  for (const c of PLANT_ROLLUP_CASES) lines.push(await rollupLine(db, c));
  return { "plant-rollups.ndjson": ndjson(lines) };
}
