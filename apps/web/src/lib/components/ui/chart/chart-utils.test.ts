import { describe, expect, test } from "bun:test";
import { type ChartConfig, getPayloadConfigFromPayload } from "./chart-utils";

const config: ChartConfig = {
  pv: { label: "Solar" },
  load: { label: "House" },
  fallback: { label: "Fallback" },
};

const payload = (over: Record<string, unknown> = {}) => ({ ...over }) as never;

describe("getPayloadConfigFromPayload", () => {
  test("a payload that is not an object has no config", () => {
    expect(getPayloadConfigFromPayload(config, null as never, "pv")).toBeUndefined();
    expect(getPayloadConfigFromPayload(config, "pv" as never, "pv")).toBeUndefined();
  });

  test("the key itself selects its entry", () => {
    expect(getPayloadConfigFromPayload(config, payload(), "pv")).toBe(config.pv);
  });

  test("a payload carrying the lookup key selects that entry", () => {
    expect(getPayloadConfigFromPayload(config, payload({ key: "load" }), "load")).toBe(config.load);
  });

  test("a payload whose label matches the key selects that label's entry", () => {
    expect(getPayloadConfigFromPayload(config, payload({ label: "pv" }), "pv")).toBe(config.pv);
  });

  test("a string field on the payload named by the key redirects the lookup", () => {
    expect(getPayloadConfigFromPayload(config, payload({ name: "load" }), "name")).toBe(
      config.load,
    );
  });

  test("a non-string field is ignored", () => {
    expect(getPayloadConfigFromPayload(config, payload({ pv: 3 }), "pv")).toBe(config.pv);
  });

  test("a string field in the payload's own config redirects the lookup", () => {
    const p = payload({ config: { series: "load" } });
    expect(getPayloadConfigFromPayload(config, p, "series")).toBe(config.load);
  });

  test("a payload config that is not an object is ignored", () => {
    expect(getPayloadConfigFromPayload(config, payload({ config: "load" }), "pv")).toBe(config.pv);
    expect(getPayloadConfigFromPayload(config, payload({ config: null }), "pv")).toBe(config.pv);
  });

  test("a string field in the row data redirects the lookup", () => {
    expect(getPayloadConfigFromPayload(config, payload(), "series", { series: "load" })).toBe(
      config.load,
    );
  });

  test("absent or empty row data is ignored", () => {
    expect(getPayloadConfigFromPayload(config, payload(), "pv", null)).toBe(config.pv);
    expect(getPayloadConfigFromPayload(config, payload(), "pv", {})).toBe(config.pv);
  });

  test("a redirect to a label the config lacks falls back to the key's own entry", () => {
    expect(getPayloadConfigFromPayload(config, payload(), "fallback", { fallback: "gone" })).toBe(
      config.fallback,
    );
  });

  test("a key the config lacks is undefined", () => {
    expect(getPayloadConfigFromPayload(config, payload(), "ghost")).toBeUndefined();
  });
});
