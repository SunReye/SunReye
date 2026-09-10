import { describe, expect, test } from "bun:test";

import { deviceBadge } from "./device-badge";
import type { DeviceState, DeviceView } from "./device-types";

const device = (state: DeviceState): DeviceView =>
  ({
    state,
    kind: state === "virtual" ? "virtual" : state === "integration" ? "coded" : "modbus",
  }) as DeviceView;

describe("the badge a device row carries", () => {
  test("only the device being read is painted as healthy", () => {
    expect(deviceBadge(device("polling"))).toEqual({
      label: "Polling",
      ok: true,
      hint: null,
      href: null,
    });
    for (const state of ["idle", "integration", "virtual", "retired"] as const) {
      expect(deviceBadge(device(state)).ok).toBe(false);
    }
  });

  // #213: the Modbus release-limit hint sat on every unpolled row, so an
  // MQTT-fed loadpoint and the optimizer both explained themselves as devices
  // waiting for a release that has nothing to do with them.
  test("the polling hint belongs to an idle Modbus device and to nothing else", () => {
    expect(deviceBadge(device("idle")).hint).toBe(
      "This release polls one device; the others are stored but not read.",
    );
    for (const state of ["polling", "integration", "virtual", "retired"] as const) {
      expect(deviceBadge(device(state)).hint).toBeNull();
    }
  });

  test("an integration's badge leads to where its feed is configured", () => {
    const badge = deviceBadge(device("integration"));
    expect(badge.label).toBe("via MQTT");
    expect(badge.href).toBe("/settings/mqtt");
  });

  test("an internal device says internal, and leads nowhere — there is nothing to configure", () => {
    const badge = deviceBadge(device("virtual"));
    expect(badge.label).toBe("internal");
    expect(badge.href).toBeNull();
  });

  test("retirement outranks how the device was fed", () => {
    expect(deviceBadge({ ...device("retired"), kind: "coded" } as DeviceView).label).toBe(
      "Retired",
    );
  });
});
