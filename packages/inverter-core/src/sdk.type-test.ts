// fallow-ignore-file unused-file -- compile-time-only assertions; nothing imports this by design, tsc is the consumer
// Type-only assertions, imported by nothing on purpose (checked by tsc).
/**
 * Compile-time assertions for the `metric()` builder's role-shape enforcement.
 * This file has no runtime tests — it exists so `tsc --noEmit` fails if the
 * type-level guarantees regress. Each `@ts-expect-error` MUST error; tsc flags
 * an unused directive if the guard silently stops working.
 */
import { defineFamily, metric } from "./define";

// Indexed role requires `index`.
// @ts-expect-error - pv.string.power is indexed; missing `index`
metric("dc/pv1/power", { label: "PV1", group: "inverter", addr: 672, role: "pv.string.power" });
metric("dc/pv1/power", {
  label: "PV1",
  group: "inverter",
  addr: 672,
  role: "pv.string.power",
  index: 1,
});

// Enum/status role requires `enumLabels`.
// @ts-expect-error - inverter.status needs enumLabels
metric("inverter/status", {
  label: "Status",
  group: "inverter",
  addr: 500,
  role: "inverter.status",
});
metric("inverter/status", {
  label: "Status",
  group: "inverter",
  addr: 500,
  role: "inverter.status",
  enumLabels: { 0: "Standby" },
});

// Writable role requires access "rw".
// @ts-expect-error - setting.work_mode must be access "rw"
metric("settings/workmode", {
  label: "WM",
  group: "settings",
  addr: 142,
  role: "setting.work_mode",
  enumLabels: { 0: "x" },
});
metric("settings/workmode", {
  label: "WM",
  group: "settings",
  addr: 142,
  access: "rw",
  role: "setting.work_mode",
  enumLabels: { 0: "x" },
});

// Unknown role rejected.
// @ts-expect-error - not a CanonicalRole
metric("foo/bar", { label: "F", group: "x", addr: 1, role: "not.a.real.role" });

// A plain, unmapped metric is fine.
metric("ac/relay_status", { label: "Relays", group: "inverter", addr: 552 });

// --- defineFamily overlay value shapes are type-checked ---
defineFamily({
  id: "fam",
  name: "Fam",
  manufacturer: "M",
  version: "1.0.0",
  metrics: [
    metric("dc/pv1/power", {
      label: "PV1",
      group: "g",
      addr: 1,
      role: "pv.string.power",
      index: 1,
    }),
  ],
  models: {
    ok: {
      metrics: {
        "dc.pv1.power": { max: 100 }, // numeric bound patch — fine
        "dc.pv1.power ": null, // any string key allowed (wildcards/adds need it)
      },
    },
    // @ts-expect-error - `max` must be a number
    badBound: { metrics: { "dc.pv1.power": { max: "lots" } } },
    // @ts-expect-error - `role` must be a CanonicalRole
    badRole: { metrics: { "dc.pv1.power": { role: "not.a.role" } } },
  },
});
