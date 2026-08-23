/**
 * The device registry's persisted shape: {@link sources} (a connection) and the
 * {@link devices} reached through it, plus the per-row validation that turns
 * table rows into records the runtime can trust.
 *
 * Deliberately *not* an `app_settings` value. `readSetting` answers a row that
 * fails its schema with the caller's default and no log line — for one scalar
 * that costs one scalar, but for a device list the default is `[]`: the server
 * would boot healthy, poll nothing, publish nothing, and say nothing about why.
 * Rows fail one at a time here, and every failure is reported to the caller.
 */

import { z } from "zod";

import type { DeviceRow, SourceRow } from "./schema/devices";

export type { DeviceInsert, DeviceRow, SourceInsert, SourceRow } from "./schema/devices";

/**
 * The source an already-running install's connection becomes. Its id is fixed
 * because the seed has to be recognisable as "the one that was already here" on
 * every later boot.
 */
export const DEFAULT_SOURCE_ID = "default";

/** How a source is spoken to — the transport that will be built for it. */
const sourceKindSchema = z.enum(["modbus", "http", "simulator"]);

/**
 * What kind of thing a device is. Drives nothing on its own — capabilities are
 * still derived from the roles a profile maps — but it is what a plant-level
 * question ("which of these has the battery?") is asked against.
 */
const deviceClassSchema = z.enum(["inverter", "meter", "battery", "loadpoint"]);

/**
 * How to pick one device out of the several sharing a connection: a Modbus unit
 * id today, a loadpoint index or an entity prefix later.
 *
 * Loose on purpose. A row written by a newer version carries addressing this
 * one does not know about, and stripping unknown keys would silently discard it
 * on the next write — a downgrade would quietly re-address the device.
 */
const deviceAddressSchema = z
  .object({
    /** Modbus unit / slave id, when the source is a shared RS485 bus. */
    unitId: z.number().int().min(0).max(255).optional(),
  })
  .loose();

const sourceRecordSchema = z.object({
  id: z.string().min(1),
  kind: sourceKindSchema,
  label: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
  enabled: z.boolean(),
});
export type SourceRecord = z.infer<typeof sourceRecordSchema>;

const deviceRecordSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  profileId: z.string().min(1),
  deviceClass: deviceClassSchema,
  label: z.string().min(1),
  address: deviceAddressSchema,
  enabled: z.boolean(),
});
export type DeviceRecord = z.infer<typeof deviceRecordSchema>;

/** A row that could not be read, and the reason, for the caller to log. */
export interface SkippedRow {
  id: string;
  reason: string;
}

/** Zod issues as one line, for a log the reader can act on. */
function reasonOf(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

/**
 * Parse rows one at a time, keeping what reads and reporting what does not.
 *
 * The alternative — parse the whole set and fail as one — is the behaviour this
 * module exists to avoid: one hand-edited row would take the entire plant with
 * it.
 */
function parseRows<Row extends { id: string }, T>(
  rows: readonly Row[],
  schema: z.ZodType<T>,
): { parsed: T[]; skipped: SkippedRow[] } {
  const parsed: T[] = [];
  const skipped: SkippedRow[] = [];
  for (const row of rows) {
    const result = schema.safeParse(row);
    if (result.success) parsed.push(result.data);
    else skipped.push({ id: row.id, reason: reasonOf(result.error) });
  }
  return { parsed, skipped };
}

export function parseSourceRows(rows: readonly SourceRow[]): {
  sources: SourceRecord[];
  skipped: SkippedRow[];
} {
  const { parsed, skipped } = parseRows(rows, sourceRecordSchema);
  return { sources: parsed, skipped };
}

export function parseDeviceRows(rows: readonly DeviceRow[]): {
  devices: DeviceRecord[];
  skipped: SkippedRow[];
} {
  const { parsed, skipped } = parseRows(rows, deviceRecordSchema);
  return { devices: parsed, skipped };
}
