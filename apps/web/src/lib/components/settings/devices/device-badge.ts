import type { Pathname } from "$app/types";
import * as m from "$lib/paraglide/messages";
import type { DeviceView } from "./device-types";

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
