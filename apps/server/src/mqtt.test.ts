import { describe, expect, test } from "bun:test";
import type { EntityConstraint, ManifestMetric } from "@SunReye/inverter-core";
import {
  type HaDevice,
  discoveryConfig,
  forecastDiscoveryConfig,
  topicsFor,
} from "./mqtt-discovery";

const topics = topicsFor("sunreye", "deye");

const haDevice: HaDevice = {
  identifiers: ["sunreye_deye"],
  name: "Deye",
  manufacturer: "Deye",
  model: "deye",
};

const metric = (over: Partial<ManifestMetric> & { key: string }): ManifestMetric => ({
  topic: over.key.replaceAll(".", "/"),
  label: over.key,
  unit: null,
  group: "test",
  kind: "measurement",
  writable: false,
  ...over,
});

const constraint = (over: Partial<EntityConstraint> = {}): EntityConstraint => ({
  writable: false,
  valueType: "number",
  ...over,
});

const configFor = (m: ManifestMetric, c: EntityConstraint) =>
  discoveryConfig(m, c, topics, "deye", haDevice);

describe("discoveryConfig", () => {
  test("a read-only measurement becomes a sensor with device + state class", () => {
    const { component, config } = configFor(
      metric({ key: "pv.power", unit: "W", kind: "measurement" }),
      constraint(),
    );
    expect(component).toBe("sensor");
    expect(config.state_topic).toBe("sunreye/deye/pv/power");
    expect(config.availability_topic).toBe("sunreye/deye/status");
    expect(config.unique_id).toBe("sunreye_deye_pv_power");
    expect(config.default_entity_id).toBe("sensor.sunreye_pv_power");
    expect(config.device_class).toBe("power");
    expect(config.state_class).toBe("measurement");
    expect(config.command_topic).toBeUndefined();
  });

  test("a cumulative counter is total_increasing", () => {
    const { config } = configFor(
      metric({ key: "grid.import", unit: "kWh", kind: "cumulative" }),
      constraint(),
    );
    expect(config.state_class).toBe("total_increasing");
    expect(config.device_class).toBe("energy");
  });

  test("a percentage is only a battery device_class in the SOC role", () => {
    const soc = configFor(
      metric({ key: "battery.soc", unit: "%", role: "battery.soc" }),
      constraint(),
    );
    expect(soc.config.device_class).toBe("battery");
    const other = configFor(metric({ key: "pv.ratio", unit: "%" }), constraint());
    expect(other.config.device_class).toBeUndefined();
  });

  test("a writable number carries the profile range, falling back to a wide envelope", () => {
    const bounded = configFor(
      metric({ key: "setting.charge", unit: "A", writable: true }),
      constraint({ writable: true, min: 0, max: 185 }),
    );
    expect(bounded.component).toBe("number");
    expect(bounded.config.command_topic).toBe("sunreye/deye/setting/charge/set");
    expect(bounded.config.min).toBe(0);
    expect(bounded.config.max).toBe(185);
    expect(bounded.config.default_entity_id).toBe("number.sunreye_setting_charge");

    const unbounded = configFor(
      metric({ key: "setting.power", writable: true }),
      constraint({ writable: true }),
    );
    expect(unbounded.config.max).toBe(100_000);
  });

  test("a writable enum becomes a select mapping labels both ways", () => {
    const { component, config } = configFor(
      metric({ key: "setting.mode", writable: true, enumLabels: { 0: "Off", 1: "On" } }),
      constraint({ writable: true, valueType: "enum", enumValues: [0, 1] }),
    );
    expect(component).toBe("select");
    expect(config.options).toEqual(["Off", "On"]);
    expect(config.command_template).toContain('"Off":0');
    expect(String(config.value_template)).toContain('"0":"Off"');
  });

  test("a read-only enum stays a sensor that renders the label", () => {
    const { component, config } = configFor(
      metric({ key: "status.code", enumLabels: { 2: "Normal" } }),
      constraint(),
    );
    expect(component).toBe("sensor");
    expect(config.command_topic).toBeUndefined();
    expect(String(config.value_template)).toContain('"2":"Normal"');
  });
});

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
