/**
 * THE ONE TABLE OF FRAMING NAMES.
 *
 * Three surfaces used to keep their own hardcoded English pair — the inverter
 * panel's select, the connection dialog's Modbus fields, and the roster's group
 * caption — so a third framing was three edits in three files, and a German
 * operator read "Modbus RTU over TCP" on a page whose every other word was
 * translated. Which framings exist is a build fact; what they are called is a
 * translation, and the copies tangled the two.
 *
 * `TRANSPORTS` is the order the select offers, and plain TCP leads it: it is
 * what a generic gateway wants and the framing a blank draft opens on. It is
 * private — a caller wanting the list wants it LABELLED, which is
 * {@link transportOptions}.
 */

import * as m from "$lib/paraglide/messages";
import type { Transport } from "./inverter-types";

const TRANSPORTS = ["tcp", "rtu-over-tcp", "solarman-v5"] as const satisfies readonly Transport[];

const TRANSPORT_MESSAGES: Record<Transport, () => string> = {
  tcp: m.inverter_transport_tcp,
  "rtu-over-tcp": m.inverter_transport_rtu_over_tcp,
  "solarman-v5": m.inverter_transport_solarman_v5,
};

/**
 * What to call a framing, in the reader's language.
 *
 * Takes a plain `string` rather than a `Transport`, because a connection row is
 * a document the SERVER wrote: a build that has been rolled back reads a
 * framing it has no name for, and a row's own spelling is a usable caption
 * where an empty string loses the whole line it sits in.
 */
export function transportLabel(transport: string): string {
  return TRANSPORT_MESSAGES[transport as Transport]?.() ?? transport;
}

/** The select's options: every framing this build can dial, labelled, in order. */
export function transportOptions(): { value: Transport; label: string }[] {
  return TRANSPORTS.map((value) => ({ value, label: transportLabel(value) }));
}
