// What a device row SAYS: its role's name, the one badge its state earns, and
// the meta line under its name. Words, not markup — the row components render
// them, and these are the decisions a test can hold.

import type { Pathname } from "$app/types";
import * as m from "$lib/paraglide/messages";
import type { DeviceView } from "./device-types";

/**
 * Every role a device row may carry — the addable ones AND the virtual
 * `optimizer`, which registers itself and is never offered in the Add dialog.
 * Keyed by string rather than by `AddableRole` for exactly that reason: the
 * optimizer's badge read `optimizer` in the roster because it had no label and
 * no place in the addable list either (#213).
 */
const ROLE_LABELS: Record<string, () => string> = {
  inverter: m.devices_role_inverter,
  meter: m.devices_role_meter,
  charger: m.devices_role_charger,
  controller: m.devices_role_controller,
  optimizer: m.devices_role_optimizer,
};

/** The translated name of a role; a role this build does not know shows as itself. */
export function roleLabel(role: string): string {
  return ROLE_LABELS[role]?.() ?? role;
}

/** The one badge a device row carries, as the row renders it. */
export type DeviceBadge = {
  label: string;
  /** Painted as healthy. Nothing sets it today: the healthy row has no badge. */
  ok: boolean;
  /** Hover text, or null. Only the Modbus release limit has one. */
  hint: string | null;
  /** Where the badge leads, or null when it is not a link. */
  href: Pathname | null;
};

/**
 * What a device's state says on its row.
 *
 * THE HEALTHY STATE SAYS NOTHING. A green "Polling" pill on the one row that is
 * working is the state an operator never has to act on, and it was the loudest
 * thing in the card — so `polling` answers null and the row renders no badge.
 * Every other state still speaks, because each of those is a reason a reading
 * is missing.
 *
 * A decision, not markup: `idle` explains itself on hover because "not polled"
 * reads as a fault and is a release limit, while a PROVIDED and an internal
 * device carry NO such hint — neither is polled by design, and the Modbus hint
 * told an EVCC loadpoint's owner their charger was waiting for a release
 * (#213).
 *
 * NOTHING here is a link any more. The provided badge used to point at the MQTT
 * tab, which is gone: what provides this device is an integration ROW, listed in
 * the same connection group a few lines away, with its own Edit, toggle and
 * Remove. A link from the devices page back to the devices page is a no-op
 * dressed as navigation, so `href` stays null on every arm — the field is kept
 * because a badge that DOES lead somewhere (an integration with a page of its
 * own) is a plausible next arm, and the renderer already handles it.
 */
export function deviceBadge(device: DeviceView): DeviceBadge | null {
  switch (device.state) {
    case "retired":
      return { label: m.devices_badge_retired(), ok: false, hint: null, href: null };
    case "polling":
      return null;
    case "provided":
      return { label: m.devices_badge_provided(), ok: false, hint: null, href: null };
    case "virtual":
      return { label: m.devices_badge_internal(), ok: false, hint: null, href: null };
    default:
      return {
        label: m.devices_badge_not_polled(),
        ok: false,
        hint: m.devices_not_polled_hint(),
        href: null,
      };
  }
}

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
 * A pure function so the rule is checked (`./device-words.test.ts`) rather
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
