import { describe, expect, test } from "bun:test";
import { nodeDetail } from "./node-details";
import type { CanonicalRole, InverterCapabilities, ManifestMetric } from "$lib/inverter/types";

const metric = (role: CanonicalRole, index?: number): ManifestMetric =>
  ({
    key: index === undefined ? role : `${role}#${index}`,
    topic: role.replaceAll(".", "/"),
    label: role,
    unit: null,
    group: role.split(".")[0],
    kind: "measurement",
    storage: "series",
    writable: false,
    role,
    ...(index === undefined ? {} : { index }),
  }) as ManifestMetric;

const caps = (over: Partial<InverterCapabilities> = {}): InverterCapabilities =>
  ({
    pvStrings: 0,
    phases: 1,
    battery: false,
    backupLoad: false,
    generator: false,
    grid: false,
    features: [],
    controls: [],
    ...over,
  }) as InverterCapabilities;

/** Row keys of a node's detail, or null when it has none to show. */
const rowsOf = (id: string, metrics: ManifestMetric[], c = caps()) =>
  nodeDetail(id, metrics, c)?.rows.map((m) => m.key) ?? null;

describe("nodeDetail — which readings belong to which node", () => {
  test("the battery node carries the whole battery subsystem", () => {
    const metrics = [
      metric("battery.soc"),
      metric("battery.power"),
      metric("battery.temperature"),
      metric("battery.energy.charged.today"),
      metric("pv.total.power"),
    ];
    const detail = nodeDetail("battery", metrics, caps({ battery: true }));
    // Charge state goes to the bar and power to the headline chart, so the rows
    // are what is left of the subsystem — and nothing from another one.
    expect(detail?.rows.map((m) => m.key)).toEqual([
      "battery.temperature",
      "battery.energy.charged.today",
    ]);
    expect(detail?.batteryBar).toBe(true);
  });

  test("the grid node carries its counters and one block per phase", () => {
    const metrics = [
      metric("grid.power"),
      metric("grid.energy.imported.today"),
      metric("grid.phase.voltage", 1),
      metric("grid.phase.current", 1),
      metric("grid.phase.voltage", 2),
    ];
    const detail = nodeDetail("grid", metrics, caps({ grid: true, phases: 2 }));
    expect(detail?.rows.map((m) => m.key)).toEqual(["grid.energy.imported.today"]);
    expect(detail?.groups.map((g) => g.metrics.map((m) => m.key))).toEqual([
      ["grid.phase.voltage#1", "grid.phase.current#1"],
      ["grid.phase.voltage#2"],
    ]);
  });

  test("one PV node is one string — the others' readings stay in their own dialog", () => {
    const metrics = [
      metric("pv.string.power", 1),
      metric("pv.string.voltage", 1),
      metric("pv.string.power", 2),
    ];
    expect(rowsOf("pv1", metrics, caps({ pvStrings: 2 }))).toEqual(["pv.string.voltage#1"]);
    expect(rowsOf("pv2", metrics, caps({ pvStrings: 2 }))).toEqual([]);
    expect(nodeDetail("pv2", metrics, caps({ pvStrings: 2 }))?.primary?.metric.key).toBe(
      "pv.string.power#2",
    );
  });

  test("the aggregate solar node carries the plant's production instead", () => {
    // Rendered when the profile maps no per-string power at all.
    const metrics = [metric("pv.total.power"), metric("production.today")];
    expect(rowsOf("solar", metrics)).toEqual(["production.today"]);
  });

  test("the hub is the inverter itself — status, temperatures, and the DC it converts", () => {
    const metrics = [
      metric("inverter.status"),
      metric("inverter.temperature.dc"),
      metric("inverter.efficiency"),
      metric("pv.total.power"),
      metric("battery.soc"),
    ];
    // Total DC power is the headline (see below), so the rows are the
    // inverter's own state.
    expect(rowsOf("hub", metrics)).toEqual([
      "inverter.status",
      "inverter.temperature.dc",
      "inverter.efficiency",
    ]);
  });

  test("the load node carries house consumption and its phases", () => {
    const metrics = [
      metric("load.power"),
      metric("load.energy.today"),
      metric("load.phase.power", 1),
      metric("load.phase.current", 1),
    ];
    const detail = nodeDetail("load", metrics, caps({ backupLoad: true, phases: 1 }));
    expect(detail?.rows.map((m) => m.key)).toEqual(["load.energy.today"]);
    expect(detail?.groups.map((g) => g.metrics.map((m) => m.key))).toEqual([
      ["load.phase.power#1", "load.phase.current#1"],
    ]);
  });

  test("a separately metered backup output reads on the home node", () => {
    // Two shapes map to one node. A whole-home UPS — every published Deye —
    // meters its islanded output once, as house load, so `load.*` already is the
    // backup reading. A vendor that meters the output apart maps `backup.*`, and
    // those readings had nowhere to go once /system retired.
    const metrics = [
      metric("load.power"),
      metric("load.energy.today"),
      metric("backup.power"),
      metric("backup.energy.today"),
    ];
    expect(rowsOf("load", metrics, caps({ backupLoad: true }))).toEqual([
      "load.energy.today",
      "backup.power",
      "backup.energy.today",
    ]);
  });

  test("a plant that meters no backup output shows no backup rows", () => {
    // The roles are unmapped for every profile shipped today, and an unmapped
    // role renders nothing — the home node is unchanged for all of them.
    const metrics = [metric("load.power"), metric("load.energy.today")];
    expect(rowsOf("load", metrics, caps({ backupLoad: true }))).toEqual(["load.energy.today"]);
  });

  test("the generator node carries its own subsystem", () => {
    const metrics = [
      metric("generator.power"),
      metric("generator.energy.today"),
      metric("generator.energy.total"),
      metric("generator.phase.current", 1),
    ];
    const detail = nodeDetail("generator", metrics, caps({ generator: true, phases: 1 }));
    expect(detail?.rows.map((m) => m.key)).toEqual([
      "generator.energy.today",
      "generator.energy.total",
    ]);
    expect(detail?.groups.map((g) => g.metrics.map((m) => m.key))).toEqual([
      ["generator.phase.current#1"],
    ]);
  });
});

describe("nodeDetail — the headline reading", () => {
  test("the node's own quantity leads the dialog with its history", () => {
    // What the KPI cards on /system carried: the live number plus the sparkline
    // behind it. It is the node's own reading, so it must not also appear as a
    // row underneath.
    const metrics = [metric("grid.power"), metric("grid.energy.imported.today")];
    const detail = nodeDetail("grid", metrics, caps({ grid: true }));
    expect(detail?.primary?.metric.key).toBe("grid.power");
    expect(detail?.rows.map((r) => r.key)).toEqual(["grid.energy.imported.today"]);
  });

  test("a signed quantity says so, so the chart splits at zero", () => {
    expect(
      nodeDetail("grid", [metric("grid.power")], caps({ grid: true }))?.primary?.diverging,
    ).toBe(true);
    expect(
      nodeDetail("load", [metric("load.power")], caps({ backupLoad: true }))?.primary?.diverging,
    ).toBe(false);
  });

  test("the battery keeps its bar and its power headline, and repeats neither", () => {
    const metrics = [metric("battery.soc"), metric("battery.power"), metric("battery.voltage")];
    const detail = nodeDetail("battery", metrics, caps({ battery: true }));
    expect(detail?.batteryBar).toBe(true);
    expect(detail?.primary?.metric.key).toBe("battery.power");
    expect(detail?.rows.map((r) => r.key)).toEqual(["battery.voltage"]);
  });

  test("the hub's headline is the DC it converts", () => {
    // Total DC power has no node of its own once per-string power is mapped, so
    // the inverter — the thing that converts it — is where it belongs.
    const detail = nodeDetail("hub", [metric("pv.total.power"), metric("inverter.status")], caps());
    expect(detail?.primary?.metric.key).toBe("pv.total.power");
    expect(detail?.rows.map((r) => r.key)).toEqual(["inverter.status"]);
  });

  test("a string node's headline is that string's power", () => {
    const metrics = [metric("pv.string.power", 2), metric("pv.string.voltage", 2)];
    const detail = nodeDetail("pv2", metrics, caps({ pvStrings: 2 }));
    expect(detail?.primary?.metric.key).toBe("pv.string.power#2");
    expect(detail?.rows.map((r) => r.key)).toEqual(["pv.string.voltage#2"]);
  });

  test("an unmapped headline role simply leaves the dialog without one", () => {
    const detail = nodeDetail("battery", [metric("battery.voltage")], caps({ battery: true }));
    expect(detail?.primary).toBeUndefined();
    expect(detail?.rows.map((r) => r.key)).toEqual(["battery.voltage"]);
  });
});

describe("nodeDetail — nothing to show", () => {
  test("a node whose readings the profile does not map has no dialog", () => {
    // Not an empty dialog: a box that opens onto nothing is worse than a box
    // that does not open.
    expect(nodeDetail("generator", [metric("battery.soc")], caps())).toBeNull();
  });

  test("the state-of-charge bar alone is content enough to open", () => {
    const detail = nodeDetail("battery", [metric("battery.soc")], caps({ battery: true }));
    expect(detail?.batteryBar).toBe(true);
    expect(detail?.rows).toEqual([]);
  });

  test("a hidden subsystem drops out with its metrics", () => {
    // `inverter.metrics` is already filtered by Settings → Sensors, so hiding a
    // group takes its dialog with it.
    expect(nodeDetail("battery", [], caps({ battery: true }))).toBeNull();
  });

  test("the EV charger is not manifest data, so it has no manifest detail", () => {
    expect(nodeDetail("charger", [metric("load.power")], caps())).toBeNull();
  });

  test("an unknown node id is not an error", () => {
    expect(nodeDetail("nonsense", [metric("load.power")], caps())).toBeNull();
  });

  test("a phase block with no readings is dropped, not rendered empty", () => {
    const detail = nodeDetail("grid", [metric("grid.power")], caps({ grid: true, phases: 3 }));
    expect(detail?.groups).toEqual([]);
  });
});

describe("nodeDetail — titles", () => {
  test("a string node is titled by its index", () => {
    expect(nodeDetail("pv2", [metric("pv.string.power", 2)], caps({ pvStrings: 2 }))?.title).toBe(
      "String 2",
    );
  });

  test("the grid node names its phase count when it has more than one", () => {
    const metrics = [metric("grid.power")];
    expect(nodeDetail("grid", metrics, caps({ grid: true, phases: 3 }))?.title).toBe(
      "Grid · 3-phase",
    );
    expect(nodeDetail("grid", metrics, caps({ grid: true, phases: 1 }))?.title).toBe("Grid");
  });

  test("every other node uses its own name", () => {
    expect(nodeDetail("battery", [metric("battery.soc")], caps({ battery: true }))?.title).toBe(
      "Battery",
    );
    expect(nodeDetail("hub", [metric("inverter.status")], caps())?.title).toBe("Inverter");
  });
});
