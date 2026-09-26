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
  test("a Modbus row keeps the addressing dialog, Retire and Delete", () => {
    expect(ids({ kind: "modbus" })).toEqual(["edit", "retire", "delete"]);
    expect(actionsFor(device({ kind: "modbus" })).every((a) => !a.blocked)).toBe(true);
  });

  test("a retired Modbus row offers Restore, and Delete for a device added by mistake", () => {
    expect(ids({ kind: "modbus", state: "retired", retiredAt: "2026-09-10" })).toEqual([
      "restore",
      "delete",
    ]);
  });

  // Rendered, refused, and explained: hiding the control would take the reason
  // with it, and the operator would look for a Retire that is simply absent.
  test("the polled Modbus row renders Retire and Delete disabled rather than dropping them", () => {
    expect(actionsFor(device({ kind: "modbus", state: "polling" }))).toEqual([
      { id: "edit", blocked: false, placement: "primary" },
      { id: "retire", blocked: true, placement: "menu" },
      { id: "delete", blocked: true, placement: "menu" },
    ]);
  });

  // #219: the server now allows `name` and `retired` on a coded row. Before
  // that the whole PATCH was refused, so the row offered a link and nothing
  // else — an EVCC loadpoint could not even be renamed.
  test("a coded row offers rename, retire and delete, never the addressing dialog", () => {
    expect(ids({ kind: "coded", state: "provided", integration: "evcc" })).toEqual([
      "rename",
      "retire",
      "delete",
    ]);
  });

  test("a retired coded row offers Restore and Delete", () => {
    expect(
      ids({ kind: "coded", state: "retired", integration: "evcc", retiredAt: "2026-09-10" }),
    ).toEqual(["restore", "delete"]);
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

  // The server refuses to delete the optimizer: it registers itself on boot.
  test("a virtual row never offers Delete", () => {
    expect(ids({ kind: "virtual", state: "virtual" })).not.toContain("delete");
    expect(ids({ kind: "virtual", state: "retired", retiredAt: "x" })).not.toContain("delete");
  });

  /**
   * ONE visible control per row, the rest behind its menu. A phone row used to
   * stack two full-width buttons under every device, which put three devices on
   * a screen; the row now carries its identity and one button side by side.
   */
  test("exactly one control is primary, and it is the first; the rest sit in the menu", () => {
    const cases: Partial<DeviceView>[] = [
      { kind: "modbus" },
      { kind: "modbus", state: "polling" },
      { kind: "modbus", state: "retired", retiredAt: "x" },
      { kind: "coded", state: "provided" },
      { kind: "coded", state: "retired", retiredAt: "x" },
      { kind: "virtual", state: "virtual" },
    ];
    for (const over of cases) {
      const actions = actionsFor(device(over));
      expect(actions[0]?.placement).toBe("primary");
      expect(actions.slice(1).every((a) => a.placement === "menu")).toBe(true);
    }
  });

  test("an unknown kind offers nothing rather than throwing", () => {
    expect(ids({ kind: "gateway" as DeviceKind })).toEqual([]);
  });
});
