import { describe, expect, test } from "bun:test";
import { coercePayload, parseLoadpointTopic, parseVehicleTopic } from "./evcc-topics";

describe("parseLoadpointTopic", () => {
  test("parses a simple leaf into index + key", () => {
    expect(parseLoadpointTopic("evcc", "evcc/loadpoints/1/chargePower")).toEqual({
      index: 1,
      key: "chargePower",
    });
  });

  test("joins nested keys (multi-segment remainder)", () => {
    expect(parseLoadpointTopic("evcc", "evcc/loadpoints/2/chargeCurrents/l1")).toEqual({
      index: 2,
      key: "chargeCurrents/l1",
    });
    expect(parseLoadpointTopic("evcc", "evcc/loadpoints/1/planStrategy/continuous")).toEqual({
      index: 1,
      key: "planStrategy/continuous",
    });
  });

  test("ignores the retained loadpoint-count topic", () => {
    expect(parseLoadpointTopic("evcc", "evcc/loadpoints")).toBeNull();
  });

  test("ignores command topics and non-loadpoint topics", () => {
    expect(parseLoadpointTopic("evcc", "evcc/loadpoints/1/mode/set")).toBeNull();
    expect(parseLoadpointTopic("evcc", "evcc/site/pvPower")).toBeNull();
    expect(parseLoadpointTopic("evcc", "evcc/status")).toBeNull();
  });

  test("rejects non-numeric or bare indexes", () => {
    expect(parseLoadpointTopic("evcc", "evcc/loadpoints/x/mode")).toBeNull();
    expect(parseLoadpointTopic("evcc", "evcc/loadpoints/1")).toBeNull();
  });

  test("honors a custom topic root", () => {
    expect(parseLoadpointTopic("my/evcc", "my/evcc/loadpoints/1/mode")).toEqual({
      index: 1,
      key: "mode",
    });
    expect(parseLoadpointTopic("my/evcc", "evcc/loadpoints/1/mode")).toBeNull();
  });
});

describe("parseVehicleTopic", () => {
  test("parses a leaf into the config name + key", () => {
    expect(parseVehicleTopic("evcc", "evcc/vehicles/tesla_ble/limitSoc")).toEqual({
      name: "tesla_ble",
      key: "limitSoc",
    });
  });

  test("joins nested keys (multi-segment remainder)", () => {
    expect(parseVehicleTopic("evcc", "evcc/vehicles/tesla_ble/planSoc/0/soc")).toEqual({
      name: "tesla_ble",
      key: "planSoc/0/soc",
    });
  });

  test("ignores the count topic, bare names and non-vehicle topics", () => {
    expect(parseVehicleTopic("evcc", "evcc/vehicles")).toBeNull();
    expect(parseVehicleTopic("evcc", "evcc/vehicles/tesla_ble")).toBeNull();
    expect(parseVehicleTopic("evcc", "evcc/loadpoints/1/limitSoc")).toBeNull();
    expect(parseVehicleTopic("evcc", "evcc/status")).toBeNull();
  });

  test("ignores command echoes — our own vehicle limit writes land here", () => {
    expect(parseVehicleTopic("evcc", "evcc/vehicles/tesla_ble/limitSoc/set")).toBeNull();
  });

  test("honors a custom topic root", () => {
    expect(parseVehicleTopic("my/evcc", "my/evcc/vehicles/vw/limitSoc")).toEqual({
      name: "vw",
      key: "limitSoc",
    });
    expect(parseVehicleTopic("my/evcc", "evcc/vehicles/vw/limitSoc")).toBeNull();
  });
});

describe("coercePayload", () => {
  test("numbers", () => {
    expect(coercePayload("3600")).toBe(3600);
    expect(coercePayload("-1831")).toBe(-1831);
    expect(coercePayload("97.219")).toBe(97.219);
  });

  test("booleans", () => {
    expect(coercePayload("true")).toBe(true);
    expect(coercePayload("false")).toBe(false);
  });

  test("null and empty (retained-delete) payloads", () => {
    expect(coercePayload("null")).toBeNull();
    expect(coercePayload("")).toBeNull();
  });

  test("strings stay strings (modes, titles, JSON blobs)", () => {
    expect(coercePayload("pv")).toBe("pv");
    expect(coercePayload("Tesla Model 3 Premium LR RWD")).toBe("Tesla Model 3 Premium LR RWD");
    expect(coercePayload('[{"start":"2026-07-19"}]')).toBe('[{"start":"2026-07-19"}]');
  });
});
