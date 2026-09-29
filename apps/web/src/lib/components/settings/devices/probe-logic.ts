// What a probe answers, in words: the device dialog's test read, the connection
// dialog's reachability check, and the target a test read is sent to.

import * as m from "$lib/paraglide/messages";
import { modbusConnections } from "./device-form";
import type {
  AddDeviceForm,
  ConnectionKind,
  ConnectionView,
  ModbusConnectionView,
} from "./device-types";

/** The two shapes a probe answers with — the server's, or the transport's failure. */
export type ProbeAnswer = {
  ok: boolean;
  error?: string;
  metricCount?: number;
  durationMs?: number;
};

export type ProbeOutcome = { ok: boolean; message: string };

/** One line for a probe: metrics and time on success, the reason otherwise. */
export function describeProbe(
  answer: ProbeAnswer,
  words: {
    ok: (count: number, ms: number) => string;
    failed: (error: string) => string;
  },
): ProbeOutcome {
  if (answer.ok)
    return {
      ok: true,
      message: words.ok(answer.metricCount ?? 0, answer.durationMs ?? 0),
    };
  return { ok: false, message: words.failed(answer.error ?? "") };
}

/**
 * What a connection probe answers with: reachable, how long it took and — for a
 * Solarman logger stick — the serial it announced itself with, or why not.
 *
 * The serial is optional on the success arm and not on the failure one: a probe
 * that did not get an answer learned nothing about what is at the address.
 */
export type ConnectionProbeAnswer =
  | { ok: true; ms: number; serial?: number }
  | { ok: false; ms: number; error: string };

type RawProbe = { ok?: unknown; ms?: unknown; error?: unknown; logger?: unknown };

/** The elapsed millisecond count an answer states, or 0 when it states none. */
function probeMs(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

/**
 * The serial the thing that answered named itself with, or undefined.
 *
 * Nested under `logger` on the wire because a probe may one day learn other
 * things about what answered — a firmware string, a model — and a flat `serial`
 * would have to be renamed the day it does. Every shape that is not a number is
 * "no serial": a plain TCP gateway announces nothing at all, and a build one
 * version ahead may send a field this one cannot read.
 */
function probeSerial(value: unknown): number | undefined {
  const serial = (value as { serial?: unknown } | null | undefined)?.serial;
  return typeof serial === "number" ? serial : undefined;
}

/**
 * A `POST /api/connections/probe` response as the discriminated answer the
 * describer takes, with `fallback` standing in when the request itself failed
 * (a dead connection has no body to read a reason out of).
 */
export function connectionProbeAnswer(data: unknown, fallback: string): ConnectionProbeAnswer {
  const raw = (data ?? {}) as RawProbe;
  if (raw.ok === true) {
    const serial = probeSerial(raw.logger);
    return serial === undefined
      ? { ok: true, ms: probeMs(raw.ms) }
      : { ok: true, ms: probeMs(raw.ms), serial };
  }
  return {
    ok: false,
    ms: probeMs(raw.ms),
    error: typeof raw.error === "string" ? raw.error : fallback,
  };
}

/** The success line each kind gets. A table, so a third kind is one entry. */
const PROBE_OK: Record<ConnectionKind, (args: { ms: number }) => string> = {
  modbus: m.devices_ping_ok,
  mqtt: m.devices_broker_ok,
};

/**
 * One line for a CONNECTION probe, per kind.
 *
 * A gateway's success says its port is open; a broker's says it accepted an
 * MQTT CONNECT — a materially stronger claim, since a TCP connect to a broker's
 * port succeeds for every broker that is running, credentials wrong or not.
 * Reporting the Modbus wording for one would tell the operator their broker is
 * reachable when their password is what is broken.
 */
export function describeConnectionProbe(
  kind: ConnectionKind,
  answer: ConnectionProbeAnswer,
): ProbeOutcome {
  if (!answer.ok) return { ok: false, message: m.devices_ping_failed({ error: answer.error }) };
  // A discovered serial outranks the kind's own line. "Reachable" is true of
  // any open port; naming the stick that answered is how the operator knows the
  // box found THEIR logger and not a neighbour's on the same subnet.
  if (answer.serial !== undefined)
    return {
      ok: true,
      message: m.devices_ping_ok_logger({ serial: answer.serial, ms: answer.ms }),
    };
  return { ok: true, message: PROBE_OK[kind]({ ms: answer.ms }) };
}

/** What a test-read needs: a Modbus address, a slave id, and the driver to read with. */
export type ProbeTarget = ModbusConnectionView["params"] & {
  unitId: number;
  profileId: string;
};

/**
 * The probe the device dialog can run for its form, or null while it cannot: a
 * gateway that does not exist yet has no address to dial, and without a profile
 * there is no register map to read. The address is the chosen gateway's row,
 * not a draft — the dialog edits the device, and the gateway is edited on its own.
 */
export function probeTargetOf(
  form: AddDeviceForm,
  connections: readonly ConnectionView[],
): ProbeTarget | null {
  if (form.profileId === "") return null;
  const connection = modbusConnections(connections).find(
    (c) => String(c.id) === form.connectionChoice,
  );
  if (!connection) return null;
  return { ...connection.params, unitId: form.unitId, profileId: form.profileId };
}
