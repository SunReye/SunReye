import type { Pathname } from "$app/types";
import * as m from "$lib/paraglide/messages";
import type { DeviceView } from "./device-types";

/** The one badge a device row carries, as the row renders it. */
export type DeviceBadge = {
  label: string;
  /** Painted as healthy — reserved for the device actually being read. */
  ok: boolean;
  /** Hover text, or null. Only the Modbus release limit has one. */
  hint: string | null;
  /** Where the badge leads, or null when it is not a link. */
  href: Pathname | null;
};

/**
 * What a device's state says on its row.
 *
 * A decision, not markup: `idle` explains itself on hover because "not polled"
 * reads as a fault and is a release limit, while an integration and an internal
 * device carry NO such hint — neither is polled by design, and the Modbus hint
 * told an EVCC loadpoint's owner their charger was waiting for a release
 * (#213). The integration badge links to where its feed is configured instead,
 * which is the MQTT tab until #217 gives EVCC a home of its own.
 */
export function deviceBadge(device: DeviceView): DeviceBadge {
  switch (device.state) {
    case "retired":
      return { label: m.devices_badge_retired(), ok: false, hint: null, href: null };
    case "polling":
      return { label: m.devices_badge_polling(), ok: true, hint: null, href: null };
    case "integration":
      return {
        label: m.devices_badge_integration(),
        ok: false,
        hint: null,
        href: "/settings/mqtt",
      };
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
