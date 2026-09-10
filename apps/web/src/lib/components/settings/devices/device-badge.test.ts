import { describe, expect, test } from "bun:test";

import { deviceBadge } from "./device-badge";
import type { DeviceState, DeviceView } from "./device-types";

const device = (state: DeviceState): DeviceView =>
  ({
    state,
    kind: state === "virtual" ? "virtual" : state === "provided" ? "coded" : "modbus",
  }) as DeviceView;

describe("the badge a device row carries", () => {
  // The device being read carries NO badge. A green "Polling" pill on the one
  // row that is working is the state an operator never has to act on, and it
  // was the loudest thing in the card; a row saying nothing is a row that is
  // fine. Every state that is NOT the healthy one still speaks.
  test("the device being read says nothing, because nothing is wrong with it", () => {
    expect(deviceBadge(device("polling"))).toBeNull();
  });

  test("every other state still carries its badge", () => {
    for (const state of ["idle", "provided", "virtual", "retired"] as const) {
      expect(deviceBadge(device(state))?.label).toBeString();
    }
  });

  // #213: the Modbus release-limit hint sat on every unpolled row, so an
  // MQTT-fed loadpoint and the optimizer both explained themselves as devices
  // waiting for a release that has nothing to do with them.
  test("the polling hint belongs to an idle Modbus device and to nothing else", () => {
    expect(deviceBadge(device("idle"))?.hint).toBe(
      "This release polls one device; the others are stored but not read.",
    );
    for (const state of ["polling", "provided", "virtual", "retired"] as const) {
      expect(deviceBadge(device(state))?.hint ?? null).toBeNull();
    }
  });

  // The badge used to link at `/settings/mqtt`, which no longer exists: the
  // thing that provides this device is an integration ROW, listed in the very
  // group this badge is rendered in. A link from the devices page to the devices
  // page is a no-op dressed as navigation, so the badge is plain text and the
  // row's own Edit is the control.
  test("a provided device's badge is not a link — what provides it is listed beside it", () => {
    const badge = deviceBadge(device("provided"))!;
    expect(badge.label).toBe("via MQTT");
    expect(badge.href).toBeNull();
  });

  test("an internal device says internal, and leads nowhere — there is nothing to configure", () => {
    const badge = deviceBadge(device("virtual"))!;
    expect(badge.label).toBe("internal");
    expect(badge.href).toBeNull();
  });

  test("retirement outranks how the device was fed", () => {
    expect(deviceBadge({ ...device("retired"), kind: "coded" } as DeviceView)?.label).toBe(
      "Retired",
    );
  });
});
