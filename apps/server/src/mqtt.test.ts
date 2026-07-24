import { describe, expect, test } from "bun:test";
import { forecastDiscoveryConfig } from "./mqtt";

// The helper only reads a few topic fields; build a minimal stand-in and cast to
// the (unexported) Topics/HaDevice shapes rather than spinning up a real bridge.
const topics = {
  availability: "sunreye/deye/status",
  forecastState: (v: string) => `sunreye/deye/forecast/${v}`,
  forecastAttrs: (v: string) => `sunreye/deye/forecast/${v}/attributes`,
} as unknown as Parameters<typeof forecastDiscoveryConfig>[0];

const haDevice = {
  identifiers: ["sunreye_deye"],
  name: "Deye",
  manufacturer: "Deye",
  model: "deye",
} as Parameters<typeof forecastDiscoveryConfig>[2];

describe("forecastDiscoveryConfig", () => {
  test("raw variant is an energy sensor exposing the forecast via json attributes", () => {
    const { component, config } = forecastDiscoveryConfig(topics, "deye", haDevice, "raw");
    expect(component).toBe("sensor");
    expect(config.state_topic).toBe("sunreye/deye/forecast/raw");
    expect(config.json_attributes_topic).toBe("sunreye/deye/forecast/raw/attributes");
    expect(config.availability_topic).toBe("sunreye/deye/status");
    expect(config.unit_of_measurement).toBe("kWh");
    expect(config.device_class).toBe("energy");
    expect(config.unique_id).toBe("sunreye_deye_forecast");
    expect(config.device).toBe(haDevice);
  });

  test("usable variant gets its own topics, unique_id and name", () => {
    const { config } = forecastDiscoveryConfig(topics, "deye", haDevice, "usable");
    expect(config.state_topic).toBe("sunreye/deye/forecast/usable");
    expect(config.json_attributes_topic).toBe("sunreye/deye/forecast/usable/attributes");
    expect(config.unique_id).toBe("sunreye_deye_forecast_usable");
    expect(config.name).toBe("Solar forecast (usable)");
  });
});
