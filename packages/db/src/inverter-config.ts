/**
 * Inverter connection config — the runtime-editable source settings that used
 * to live only in env. Stored in `app_settings` under {@link INVERTER_KEY} and
 * validated with {@link inverterConfigSchema}. The active profile is *not* here:
 * it shapes routes/manifest/topics built once at boot, so it stays env-driven
 * (profile switching arrives with the downloadable-profile work in P3).
 *
 * Shared by the server (runtime controller) and the web app (settings form).
 */

import { z } from "zod";

import { MODBUS_TRANSPORTS } from "./connection-kinds";

/** `app_settings.key` under which the inverter config is stored. */
export const INVERTER_KEY = "inverter";

export const inverterConfigSchema = z
  .object({
    /** Modbus host. */
    host: z.string().optional(),
    port: z.number().int().default(502),
    /**
     * Framing over the socket — see {@link MODBUS_TRANSPORTS} for what each one
     * means. Derived from that list rather than restated: the two were written
     * out by hand and drifted, so this document accepted two framings while a
     * `connections` row accepted three.
     */
    transport: z.enum(MODBUS_TRANSPORTS).default("tcp"),
    /**
     * The Solarman logging stick's own serial (uint32); ignored by the other
     * framings. Optional because the port discovers it from the stick's own
     * reply — see the field of the same name in `./connection-kinds.ts`.
     */
    loggerSerial: z.number().int().min(1).max(0xffffffff).optional(),
    /** Modbus unit / slave id. */
    unitId: z.number().int().default(0),
    /** Per-request Modbus timeout, ms. */
    timeoutMs: z.number().int().default(2000),
    /**
     * Poll cadence for the God-loop, ms. Floored at 1000: a full read is
     * several sequential Modbus block requests, and the app is designed around
     * a 1 s cadence — faster ticks just get dropped by the in-flight guard.
     */
    pollIntervalMs: z.number().int().min(1000).max(3_600_000).default(1000),
    /**
     * Read a fake inverter instead of the endpoint above.
     *
     * Part of the SAVED config, not `INVERTER_SIMULATE` alone. It used to be
     * env-only, which split the inverter settings across two owners: the host
     * lived here and was editable from the dashboard, simulate lived in the
     * container's environment and was not. On a freshly flashed appliance that
     * dead-ended the path almost everyone uses — enter the inverter's address in
     * Settings, save it successfully, and keep seeing fake data, with no error
     * and nothing to click. `INVERTER_SIMULATE` now SEEDS this the first time
     * the config is read, so Docker and the addon are unchanged.
     */
    simulate: z.boolean().default(false),
  })
  // The connection settings are validated whether or not simulation is on: a
  // saved host always describes a real target, so turning simulation off is
  // never a save that can fail. The defaults are valid, so a fresh config
  // passes — a box with neither a host nor simulation is a real state (nothing
  // configured yet) and must stay parseable.
  .superRefine((cfg, ctx) => {
    for (const c of CONNECTION_CHECKS) {
      if (c.ok(cfg)) continue;
      ctx.addIssue({ code: "custom", path: [c.path], message: c.message });
    }
  });

/** Range checks applied to the Modbus connection settings. */
const CONNECTION_CHECKS: ReadonlyArray<{
  path: keyof InverterConfig;
  message: string;
  ok: (cfg: InverterConfig) => boolean;
}> = [
  { path: "port", message: "Port must be 1–65535", ok: (c) => c.port >= 1 && c.port <= 65535 },
  { path: "unitId", message: "Unit id must be 0–255", ok: (c) => c.unitId >= 0 && c.unitId <= 255 },
  {
    path: "timeoutMs",
    message: "Timeout must be 100–60000 ms",
    ok: (c) => c.timeoutMs >= 100 && c.timeoutMs <= 60_000,
  },
];
export type InverterConfig = z.infer<typeof inverterConfigSchema>;
