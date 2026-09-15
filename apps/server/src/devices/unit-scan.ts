/**
 * WHICH UNIT ID IS HOME — the scan behind the connection dialog's "find it".
 *
 * The unit id is the one field in the endpoint form that nobody can derive from
 * what they can see, and it does NOT mean the same thing on every framing:
 *
 *  - `solarman-v5` and `rtu-over-tcp` put the RTU frame on the RS485 bus
 *    verbatim, so the number is the INVERTER'S OWN slave address — what its
 *    display shows, 1 on a factory Deye. 0 is the Modbus broadcast address:
 *    every slave executes it and none answers, so it always times out.
 *  - `tcp` hands the frame to a gateway, which decides for itself what the unit
 *    id addresses. Measured on one plant's own two paths: the gateway at
 *    10.20.0.62 answers unit 0 and times out on 1 and 2, while the Solarman
 *    stick at 10.20.0.63 — same inverter — answers 1 and times out on 0.
 *
 * So the number cannot be defaulted, explained away, or carried across a
 * transport change. It can only be MEASURED, which is what this does.
 *
 * The loop is here and the socket is not: {@link UnitScanner} is the seam, the
 * same shape `./reachability.ts` uses for its dials, so the order, the early
 * stop and the bounds are testable without an inverter.
 */

import { modbusParamsSchema } from "@SunReye/db/connection-kinds";
import { z } from "zod";

/** An open endpoint that can be asked about one unit id at a time. */
export interface UnitScanner {
  /** True when this unit id answered a one-register read. */
  probe(unitId: number): Promise<boolean>;
  close(): Promise<void>;
}

/** Open the endpoint the scan runs against. Injected so the loop is testable. */
export type OpenScanner = (
  params: z.infer<typeof modbusParamsSchema>,
  profileId: string,
  timeoutMs: number,
) => Promise<UnitScanner>;

/**
 * The ids a scan tries when the caller names none, in the order it tries them.
 *
 * 1 FIRST, because it is the factory slave address of every inverter this runs
 * against and the answer on any framing that reaches the bus. 0 SECOND, because
 * it is broadcast on a bus but a working address on a gateway that terminates
 * the TCP side itself — it is a real answer here, not a mistake to be prevented.
 * Then 2..5, which is where a second inverter on a shared bus is set.
 *
 * SHORT on purpose: a miss costs the full probe timeout on every framing
 * (measured — nothing sends a fast refusal), so 1..247 would be a request that
 * takes six minutes to say no.
 */
// fallow-ignore-next-line unused-export -- the order the suite holds this module to; test files aren't traced as consumers
export const DEFAULT_UNIT_CANDIDATES: readonly number[] = [1, 0, 2, 3, 4, 5];

/** How many ids one request may spend its time on. */
// fallow-ignore-next-line unused-export -- the bound the suite holds this module to; test files aren't traced as consumers
export const MAX_CANDIDATES = 16;

/** Per-probe deadline. Shorter than a poll's: a scan is waiting for a person. */
const PROBE_TIMEOUT_MS = 1500;

const candidatesSchema = z
  .array(z.number().int().min(0).max(247))
  .min(1)
  .max(MAX_CANDIDATES, `a scan may ask at most ${MAX_CANDIDATES} unit ids`)
  .refine((ids) => new Set(ids).size === ids.length, "a unit id may only be scanned once")
  .default([...DEFAULT_UNIT_CANDIDATES]);

/**
 * What a scan takes: the endpoint, the profile whose register map it asks with,
 * and optionally which ids to try.
 *
 * MODBUS ONLY, and the union arm says so rather than a comment: a broker has no
 * unit id to find — its `unit_id` column carries an EVCC loadpoint's index,
 * which is chosen, not discovered.
 */
const scanBodySchema = z.object({
  kind: z.literal("modbus"),
  params: modbusParamsSchema,
  profileId: z.string().trim().min(1, "a profile is required to know what to read"),
  candidates: candidatesSchema,
});

/** What the scan found, and what it asked to find it. */
export interface UnitScanResult {
  /** Every id probed, in order — so "no answer" can name what was ruled out. */
  scanned: number[];
  /** The first id that answered, or null when none did. */
  found: { unitId: number; ms: number } | null;
}

/**
 * The production scanner: ONE transport for the whole scan, addressing each
 * candidate in turn.
 *
 * One rather than one per candidate because the endpoint's own cost is the
 * connect — a Solarman stick pays a V5 handshake for it, and it only ever
 * accepts a small number of clients. The transport's own `probeUnit` restores
 * the unit id it was built with, so nothing here leaks into the next probe.
 */
const modbusScanner: OpenScanner = async (params, profileId, timeoutMs) => {
  // Imported lazily so this module stays loadable without `modbus-serial`.
  const { ModbusTransport } = await import("@SunReye/inverter-core");
  const { resolveProfileById } = await import("../inverter/inverter");
  const profile = await resolveProfileById(profileId);
  if (!profile) throw new Error(`Unknown profile "${profileId}"`);
  const transport = new ModbusTransport(profile, {
    host: params.host,
    port: params.port,
    transport: params.transport,
    // The id the transport is left addressing between probes. Never used to read
    // anything — every probe names its own — but it must be a plausible one.
    unitId: DEFAULT_UNIT_CANDIDATES[0] ?? 1,
    timeoutMs: params.timeoutMs,
    ...(params.loggerSerial === undefined ? {} : { loggerSerial: params.loggerSerial }),
  });
  return {
    probe: (unitId) => transport.probeUnit(unitId, timeoutMs),
    close: () => transport.close(),
  };
};

/**
 * Probe the candidates in order and stop at the first that answers.
 *
 * FIRST, not all: the dialog is filling in one field, and every further
 * candidate costs another full timeout. A gateway carrying three devices is
 * added one device at a time, each with its own scan against the ids still free.
 */
export async function scanUnitIds(
  body: unknown,
  open: OpenScanner = modbusScanner,
): Promise<UnitScanResult> {
  const scan = scanBodySchema.parse(body);
  const scanner = await open(scan.params, scan.profileId, PROBE_TIMEOUT_MS);
  const scanned: number[] = [];
  try {
    for (const unitId of scan.candidates) {
      const started = performance.now();
      scanned.push(unitId);
      if (await scanner.probe(unitId)) {
        return { scanned, found: { unitId, ms: Math.round(performance.now() - started) } };
      }
    }
    return { scanned, found: null };
  } finally {
    // Always: the Solarman stick and every gateway have a finite client budget,
    // and a scan that leaks a socket locks the poll loop out of the endpoint the
    // operator is about to save.
    await scanner.close();
  }
}
