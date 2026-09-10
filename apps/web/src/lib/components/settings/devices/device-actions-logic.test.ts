import { describe, expect, test } from "bun:test";

import { type DeviceActionId, actionsFor } from "./device-actions-logic";
import type { DeviceKind, DeviceState, DeviceView } from "./device-types";

const device = (over: Partial<DeviceView>): DeviceView =>
  ({
    kind: "modbus" as DeviceKind,
    state: "idle" as DeviceState,
    integration: null,
    retiredAt: null,
    ...over,
  }) as DeviceView;

const ids = (over: Partial<DeviceView>): DeviceActionId[] =>
  actionsFor(device(over)).map((a) => a.id);

describe("what a device row offers its operator", () => {
  test("a Modbus row keeps the addressing dialog and Retire", () => {
    expect(ids({ kind: "modbus" })).toEqual(["edit", "retire"]);
    expect(actionsFor(device({ kind: "modbus" })).every((a) => !a.blocked)).toBe(true);
  });

  test("a retired Modbus row offers only Restore", () => {
    expect(ids({ kind: "modbus", state: "retired", retiredAt: "2026-09-10" })).toEqual(["restore"]);
  });

  // Rendered, refused, and explained: hiding the control would take the reason
  // with it, and the operator would look for a Retire that is simply absent.
  test("the polled Modbus row renders Retire disabled rather than dropping it", () => {
    expect(actionsFor(device({ kind: "modbus", state: "polling" }))).toEqual([
      { id: "edit", blocked: false },
      { id: "retire", blocked: true },
    ]);
  });

  // #219: the server now allows `name` and `retired` on a coded row. Before
  // that the whole PATCH was refused, so the row offered a link and nothing
  // else — an EVCC loadpoint could not even be renamed.
  test("a coded row offers rename and retire, never the addressing dialog", () => {
    expect(ids({ kind: "coded", state: "provided", integration: "evcc" })).toEqual([
      "rename",
      "retire",
    ]);
  });

  test("a retired coded row offers Restore and nothing else", () => {
    expect(
      ids({ kind: "coded", state: "retired", integration: "evcc", retiredAt: "2026-09-10" }),
    ).toEqual(["restore"]);
  });

  /**
   * The Configure link is GONE, on every row.
   *
   * It pointed at `/settings/mqtt`, and what lived there is now an integration
   * ROW rendered in this device's own connection group — a few lines above the
   * device, with its own Edit. So the link had nowhere left to lead that was not
   * the page the operator is already on, and a per-row list of "integrations
   * with a page of their own" was a second place to remember when one is added.
   */
  test("no row offers a Configure link, whatever provides it", () => {
    for (const integration of ["evcc", "acme", null]) {
      expect(ids({ kind: "coded", state: "provided", integration })).not.toContain("configure");
      expect(
        ids({ kind: "coded", state: "retired", integration, retiredAt: "2026-09-10" }),
      ).not.toContain("configure");
    }
  });

  // A virtual row is the optimizer. Renaming it is safe; retiring it would stop
  // the control loop from a row that looks like a label, so it is withheld.
  test("a virtual row offers rename only", () => {
    expect(ids({ kind: "virtual", state: "virtual" })).toEqual(["rename"]);
    expect(ids({ kind: "virtual", state: "retired", retiredAt: "2026-09-10" })).toEqual([
      "restore",
    ]);
  });

  test("Restore never comes with anything that would write to a retired row", () => {
    for (const kind of ["modbus", "coded", "virtual"] as const) {
      const offered = ids({ kind, state: "retired", integration: "evcc", retiredAt: "x" });
      expect(offered).toContain("restore");
      expect(offered).not.toContain("rename");
      expect(offered).not.toContain("edit");
      expect(offered).not.toContain("retire");
    }
  });

  test("an unknown kind offers nothing rather than throwing", () => {
    expect(ids({ kind: "gateway" as DeviceKind })).toEqual([]);
  });
});
