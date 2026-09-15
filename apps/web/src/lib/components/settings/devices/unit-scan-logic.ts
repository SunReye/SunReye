/**
 * THE UNIT-ID SCAN, as the dialog needs it — what to send, what to say, and what
 * the number even means on the framing that was chosen.
 *
 * The unit id is the one endpoint field nobody can read off a label, and it does
 * NOT mean the same thing on every framing. Measured on one plant's own two
 * paths to ONE inverter:
 *
 *  - the Modbus-TCP gateway at 10.20.0.62 answers unit **0** and times out on 1
 *    and 2 — the gateway terminates the TCP side and decides for itself what the
 *    id addresses;
 *  - the Solarman stick at 10.20.0.63 answers unit **1** and times out on 0 —
 *    it relays the RTU frame onto the RS485 bus, where the id is the inverter's
 *    own slave address and 0 is the broadcast address that nothing answers.
 *
 * So the field cannot be defaulted or carried across a transport change, and an
 * operator who moves a working install from a gateway to a stick will be wrong
 * with no way to know it. Hence `POST /api/connections/scan-units`, and hence
 * the per-framing help text below.
 *
 * Out of the component so `bun test` holds these rules.
 */

import { apiErrorText } from "$lib/api-error";
import * as m from "$lib/paraglide/messages";
import type { InverterConfig, Transport } from "../inverter-types";
import { type ConnectionDraft, connectionParamsOf } from "./connection-draft";
import {
  type AddDeviceForm,
  type ConnectionView,
  type ModbusConnectionView,
  NEW_CONNECTION,
} from "./device-types";

/** `POST /api/connections/scan-units`'s body, minus the candidates it defaults. */
export type UnitScanTarget = {
  kind: "modbus";
  params: ModbusConnectionView["params"];
  profileId: string;
};

/** The route's answer: every id tried, and the first that answered. */
export type UnitScanAnswer = {
  scanned: number[];
  found: { unitId: number; ms: number } | null;
};

/** One line, and the id to fill in when there is one. */
export type UnitScanOutcome = { ok: boolean; unitId: number | undefined; message: string };

/**
 * The Modbus params behind the form's gateway choice — a saved row, or the
 * endpoint being created.
 *
 * `draft` overrides the form's own for the ADD WIZARD, where step 1 edits an
 * endpoint of its own and the form carries a blank one: without it the wizard's
 * create arm could neither explain the field nor scan it, which is the flow
 * where the operator has typed the most and knows the least.
 *
 * Exported because the help text needs the FRAMING from exactly the same place
 * the scan gets its address — two resolutions could disagree, and then the page
 * would explain one endpoint while probing another.
 */
export function chosenModbusParams(
  form: AddDeviceForm,
  connections: readonly ConnectionView[],
  draft: ConnectionDraft | null = null,
): ModbusConnectionView["params"] | null {
  if (form.connectionChoice === NEW_CONNECTION) {
    const params = connectionParamsOf(draft ?? form.newConnection);
    return params?.kind === "modbus" ? params.params : null;
  }
  const row = connections.find(
    (c): c is ModbusConnectionView => c.kind === "modbus" && String(c.id) === form.connectionChoice,
  );
  return row?.params ?? null;
}

/**
 * What to scan, or null while the form cannot say.
 *
 * The DRAFT counts, unlike the test-read's target: the wizard asks for the
 * endpoint in step 1 and the profile in step 3, so the address the operator
 * typed has no row yet at the moment they need the scan most.
 */
export function scanTargetOf(
  form: AddDeviceForm,
  connections: readonly ConnectionView[],
  draft: ConnectionDraft | null = null,
): UnitScanTarget | null {
  if (form.profileId === "") return null;
  const params = chosenModbusParams(form, connections, draft);
  return params === null ? null : { kind: "modbus", params, profileId: form.profileId };
}

/**
 * The same scan, from the ONBOARDING form's shape.
 *
 * That page edits an `InverterConfig` — one flat document, no connection row —
 * and it is the first place anyone ever meets this field: a fresh install, an
 * address just typed in, and a unit id nobody has any way to know. So it gets
 * the scan too, and this is the one place its body is built.
 */
export function configScanTarget(
  cfg: InverterConfig,
  profileId: string | null,
): UnitScanTarget | null {
  const host = cfg.host?.trim() ?? "";
  if (host === "" || !profileId) return null;
  return {
    kind: "modbus",
    params: {
      host,
      port: cfg.port,
      transport: cfg.transport,
      timeoutMs: cfg.timeoutMs,
      pollIntervalMs: cfg.pollIntervalMs,
      // Absent rather than undefined: the route parses a body, and a stated
      // `loggerSerial: undefined` is not the same thing as an unstated one.
      ...(cfg.loggerSerial === undefined ? {} : { loggerSerial: cfg.loggerSerial }),
    },
    profileId,
  };
}

/** The two lines a scan can end on. Injected so the describer stays testable. */
export interface UnitScanWords {
  found(args: { unitId: number; ms: number }): string;
  none(args: { ids: string }): string;
}

/** One line for a finished scan, and the id the caller should fill in. */
// fallow-ignore-next-line unused-export -- read by `scanOutcome` below and asserted directly by the suite; test files aren't traced as consumers
export function describeUnitScan(answer: UnitScanAnswer, words: UnitScanWords): UnitScanOutcome {
  if (answer.found === null) {
    // Naming what was ruled out is the point: "no answer" alone leaves the
    // operator unable to tell a wrong id from a wrong address.
    return {
      ok: false,
      unitId: undefined,
      message: words.none({ ids: answer.scanned.join(", ") }),
    };
  }
  return { ok: true, unitId: answer.found.unitId, message: words.found(answer.found) };
}

/**
 * The whole answer to one scan request: the route's body when there is one, the
 * refusal's own reason when there is not.
 *
 * Here rather than in the component because it is where the branches are — and a
 * component that held them would be the only place that decides whether a
 * refusal can fill a field in. It cannot: `unitId` is undefined on every path
 * but a found one.
 */
export function scanOutcome(
  data: unknown,
  error: { value: unknown } | null,
  words: UnitScanWords,
  fallback: string,
): UnitScanOutcome {
  if (data === null || data === undefined) {
    return { ok: false, unitId: undefined, message: apiErrorText(error?.value, fallback) };
  }
  return describeUnitScan(data as UnitScanAnswer, words);
}

/**
 * What this number addresses on the chosen framing, or null when no framing is
 * chosen yet.
 *
 * Two texts, not three: `solarman-v5` and `rtu-over-tcp` both put the frame on
 * the bus, so they mean the same thing by the id, and `tcp` is the one that
 * does not.
 */
export function unitIdHelp(transport: Transport | null): string | null {
  if (transport === null) return null;
  return transport === "tcp" ? m.devices_unit_help_gateway() : m.devices_unit_help_bus();
}
