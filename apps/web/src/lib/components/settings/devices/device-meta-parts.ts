import * as m from "$lib/paraglide/messages";
import type { DeviceView } from "./device-types";

/** One item of a device row's meta line. */
export type DeviceMetaPart = {
  text: string;
  /** A FAULT rather than a fact — the row paints it destructively. */
  missing: boolean;
};

/**
 * What a device row says under its name.
 *
 * The slug is deliberately absent, on every kind. The shipped row led with it —
 * `evcc-loadpoint-1` under "Carport" — and a frozen identifier the operator
 * never types is what turned the card into a dump of database columns. Every
 * identifier now lives on the detail page, which is where an operator goes when
 * they actually need one.
 *
 * The unit id survives on a `modbus` device ONLY, because there it is genuinely
 * how the device is addressed: a slave id on a wire, and the one thing telling
 * two identical inverters apart. A coded device's `unit_id` is its index in the
 * integration's own config (an EVCC loadpoint's position) and nothing addresses
 * it by that number; a virtual device's is a placeholder zero.
 *
 * A pure function so the rule is checked (`./device-meta-parts.test.ts`) rather
 * than spelled out in a template nothing reads — the `{#if}` ladder this
 * replaces would also have put `device-meta.svelte` over the inline-complexity
 * ceiling once the third branch arrived.
 */
export function deviceMetaParts(device: DeviceView): DeviceMetaPart[] {
  const parts: DeviceMetaPart[] = [profilePart(device)];
  if (device.kind === "modbus") {
    parts.push({ text: m.devices_unit({ id: device.unitId }), missing: false });
  }
  const kwp = device.arrays.reduce((sum, array) => sum + array.kwp, 0);
  // Zero is not a roof: "0 kWp" reads as a measurement of one.
  if (kwp > 0) {
    parts.push({
      text: m.devices_meta_kwp({ kwp: String(Math.round(kwp * 100) / 100) }),
      missing: false,
    });
  }
  if (device.battery) {
    parts.push({
      text: m.devices_meta_kwh({ kwh: String(device.battery.usableKwh) }),
      missing: false,
    });
  }
  return parts;
}

/**
 * The profile, or the fault of not having one.
 *
 * An uninstalled profile keeps its raw id because that id is what the operator
 * has to go and install — it is the one place a bare identifier earns its place
 * on the primary surface. A profile the server knows but did not name falls
 * back to the id too, and is NOT a fault: there is nothing to fix.
 */
function profilePart(device: DeviceView): DeviceMetaPart {
  if (!device.profileKnown) {
    return { text: `${m.devices_profile_missing()} (${device.profileId})`, missing: true };
  }
  return { text: device.profileName ?? device.profileId, missing: false };
}
