import { describe, expect, test } from "bun:test";

import { offeredKinds, picksKind } from "./connection-kinds";

describe("offeredKinds", () => {
  test("an engine serving integrations offers a Modbus gateway and an MQTT broker", () => {
    expect(offeredKinds(true)).toEqual(["modbus", "mqtt"]);
  });

  test("an engine without integrations offers a Modbus gateway only", () => {
    expect(offeredKinds(false)).toEqual(["modbus"]);
  });
});

describe("picksKind", () => {
  test("two kinds on a new connection are a choice", () => {
    expect(picksKind(false, ["modbus", "mqtt"])).toBe(true);
  });

  test("a saved connection keeps its kind whatever is offered", () => {
    expect(picksKind(true, ["modbus", "mqtt"])).toBe(false);
  });

  test("one kind is stated, not chosen", () => {
    expect(picksKind(false, ["modbus"])).toBe(false);
  });

  test("no kinds offered leaves nothing to choose", () => {
    expect(picksKind(false, [])).toBe(false);
  });
});
