import { expect, test } from "bun:test";
import { roleFlow } from "./energy-colours.ts";

test("a series is drawn in the colour of the flow its role belongs to", () => {
  expect(roleFlow("pv.power")).toBe("solar");
  expect(roleFlow("pv.string.power[3]")).toBe("solar");
  expect(roleFlow("inverter.power")).toBe("solar");
  expect(roleFlow("battery.power")).toBe("battery");
  expect(roleFlow("battery.soc")).toBe("battery");
  expect(roleFlow("grid.energy.imported.total")).toBe("import");
  expect(roleFlow("price.import")).toBe("import");
  expect(roleFlow("grid.energy.exported.total")).toBe("export");
  expect(roleFlow("cost.export.rate")).toBe("export");
  expect(roleFlow("load.power")).toBe("house");
  expect(roleFlow("point.power[2]")).toBe("house");
  expect(roleFlow("ev.charge.power")).toBe("ev");
  expect(roleFlow("weather.ghi")).toBe("solar");
  expect(roleFlow("cost.savings.rate")).toBe("solar");
});

test("grid power, which runs both ways, takes the prototype's grid colour, export", () => {
  expect(roleFlow("grid.power")).toBe("export");
  expect(roleFlow("grid.phase.power[1]")).toBe("export");
});

test("a role of no flow is drawn neutral, never in a colour of its own", () => {
  expect(roleFlow("price.spot")).toBe("house");
  expect(roleFlow("extra.fan_speed")).toBe("house");
  // A prefix is matched on whole segments.
  expect(roleFlow("pvx.power")).toBe("house");
});
