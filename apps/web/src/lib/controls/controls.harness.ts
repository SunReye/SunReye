// Controls' component tests share one fake core: capabilities and each setting's stored value.
import { type Transport } from "../api/core.ts";
import { attempt, problem } from "../settings/settings.harness.ts";

export const SCHEDULE = "battery.time_of_use.enabled";

export const MAX_CHARGE = "battery.max_charge_current";
const LOCK = "battery.discharge_lock";

function capabilities(writes = true, enable = "on", scheduleEnable = "on") {
  return {
    version: "5.0.0",
    schema: { min: 1, max: 1 },
    capabilities: [],
    transports: [],
    devices: {
      "3": {
        estimated: [],
        series: [],
        writes,
        settings: [
          {
            key: MAX_CHARGE,
            name: "Max charge current",
            unit: "A",
            range: { min: 0, max: 190 },
            step: 1,
            enable,
          },
          {
            key: LOCK,
            name: "Discharge lock",
            values: [0, 1],
            labels: [
              { value: 0, text: "Unlocked" },
              { value: 1, text: "Locked" },
            ],
            step: 1,
            enable: "on",
          },
          { key: "work_mode", name: "Work mode", values: [0, 1, 2], step: 1, enable: "on" },
          {
            key: SCHEDULE,
            name: "Time-of-use schedule",
            values: [0, 1],
            labels: [
              { value: 0, text: "Off" },
              { value: 1, text: "On" },
            ],
            step: 1,
            enable: scheduleEnable,
          },
          ...[1, 2].flatMap((n) => slot(n)),
        ],
      },
    },
  };
}

/** Time-of-use slot `n`'s settings, as a Deye profile declares them. */
function slot(n: number) {
  const key = `battery.time_of_use.${n}`;

  return [
    {
      key: `${key}.start`,
      name: `Slot ${n} start`,
      range: { min: 0, max: 1435 },
      step: 5,
      time: true,
      enable: "on",
    },
    {
      key: `${key}.power`,
      name: `Slot ${n} power`,
      unit: "W",
      range: { min: 0, max: 10000 },
      step: 1,
      enable: "on",
    },
    {
      key: `${key}.soc`,
      name: `Slot ${n} SOC target`,
      unit: "%",
      range: { min: 0, max: 100 },
      step: 1,
      enable: "on",
    },
    {
      key: `${key}.grid_charge`,
      name: `Slot ${n} grid charge`,
      values: [0, 1],
      labels: [
        { value: 0, text: "Off" },
        { value: 1, text: "On" },
      ],
      step: 1,
      enable: "on",
    },
  ];
}

/** Each setting's value on the device before any write. */
function stored(): Map<string, number> {
  return new Map([
    [MAX_CHARGE, 100],
    [LOCK, 0],
    ["work_mode", 1],
    [SCHEDULE, 0],
    ["battery.time_of_use.1.start", 6 * 60],
    ["battery.time_of_use.1.power", 3000],
    ["battery.time_of_use.1.soc", 80],
    ["battery.time_of_use.1.grid_charge", 0],
    ["battery.time_of_use.2.start", 22 * 60],
  ]);
}

/** A core holding each setting's value: a write stores it unless `refuse` answers instead. */
export function controlsCore(
  options: Readonly<{
    writes?: boolean;
    enable?: string;
    /** The schedule switch's enable (ADR 8). */
    scheduleEnable?: string;
    refuse?: () => Response;
  }> = {},
): Transport & { readonly writes: string[] } {
  const { writes: on = true, enable = "on", scheduleEnable = "on", refuse } = options;
  const support = capabilities(on, enable, scheduleEnable);
  const writes: string[] = [];

  const values = stored();

  return {
    base: "http://core.test/",
    writes,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;

      if (path === "/api/v1/capabilities") return Response.json(support);

      const key = /^\/api\/v1\/devices\/3\/settings\/(.+)$/u.exec(path)?.[1];

      if (key === undefined) return problem(404, "request.route");

      if (request.method === "GET") return Response.json({ value: values.get(key) ?? null });

      const body = await request.text();

      writes.push(`${request.method} ${path} ${body}`);

      if (refuse) return refuse();

      const value = Number(/"value":(\d+)/u.exec(body)?.[1]);

      values.set(key, value);

      return Response.json(attempt({ requested: value, after: value }));
    },
  };
}
