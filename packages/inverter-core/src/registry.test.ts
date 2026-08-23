import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { ModbusInverter } from "./driver";
import {
  createInverter,
  getProfile,
  listProfiles,
  registerProfile,
  tryGetProfile,
  unregisterProfile,
} from "./registry";
import { SimulatedInverter } from "./simulator";
import type { InverterConnection, InverterProfile, MetricDef } from "./types";

/**
 * The registry is process-global module state shared with every other test file
 * in the run (and, in production, with whatever profile packages imported
 * themselves at boot). Snapshot it, run each test on an empty registry so the
 * "(none installed)" and ordering assertions are deterministic, then restore the
 * original contents in their original insertion order.
 */
let snapshot: InverterProfile[] = [];

beforeEach(() => {
  snapshot = listProfiles();
  for (const p of snapshot) unregisterProfile(p.id);
});

afterEach(() => {
  for (const p of listProfiles()) unregisterProfile(p.id);
  for (const p of snapshot) registerProfile(p);
});

const metric = ({
  type = "U_WORD",
  addresses = [100],
  ...over
}: Partial<MetricDef> & { key: string }): MetricDef => ({
  topic: over.key.replaceAll(".", "/"),
  label: over.key,
  unit: null,
  group: "test",
  type,
  addresses,
  // The planner addresses through the binding; the legacy mirror above stays in
  // step with it exactly as `hydrateProfile` keeps it.
  binding: { via: "modbus", addr: addresses, type },
  scale: 1,
  access: "r",
  ...over,
});

const profile = (id: string, over: Partial<InverterProfile> = {}): InverterProfile => ({
  id,
  name: `Name ${id}`,
  manufacturer: "ACME",
  metrics: [
    metric({ key: "pv.total.power", role: "pv.total.power", unit: "W", addresses: [10] }),
    metric({ key: "battery.soc", role: "battery.soc", unit: "%", addresses: [11] }),
    metric({
      key: "setting.work_mode",
      role: "setting.work_mode",
      access: "rw",
      addresses: [12],
      enumLabels: { 0: "Selling First", 1: "Zero Export" },
    }),
  ],
  ...over,
});

const connection: InverterConnection = { host: "10.0.0.5", port: 502, unitId: 1 };

describe("registerProfile", () => {
  test("hands the profile straight back so a package can `export default registerProfile(...)`", () => {
    const p = profile("deye-sg05lp3");
    // Identity, not a clone: profile packages register and export in one
    // expression, and callers compare by reference.
    expect(registerProfile(p)).toBe(p);
  });

  test("keys the profile by its `id`, never by name or manufacturer", () => {
    registerProfile(profile("deye-sg05lp3", { name: "Deye SG05LP3" }));

    expect(getProfile("deye-sg05lp3").name).toBe("Deye SG05LP3");
    expect(tryGetProfile("Deye SG05LP3")).toBeUndefined();
    expect(tryGetProfile("ACME")).toBeUndefined();
  });

  test("a duplicate id replaces the old profile instead of installing a second entry", () => {
    // Upgrading an installed profile re-registers the same id. A second list
    // entry would mean two dropdown rows and an ambiguous active profile.
    const v1 = profile("deye-sg05lp3", { name: "v1" });
    const v2 = profile("deye-sg05lp3", { name: "v2" });
    registerProfile(v1);
    registerProfile(v2);

    expect(listProfiles()).toHaveLength(1);
    expect(getProfile("deye-sg05lp3")).toBe(v2);
  });

  test("re-registering an id keeps its original position in the list", () => {
    // The UI renders the profile picker in registry order; an in-place upgrade
    // must not make an installed inverter jump to the bottom of the list.
    registerProfile(profile("a"));
    registerProfile(profile("b"));
    registerProfile(profile("c"));
    const upgraded = profile("a", { name: "a upgraded" });
    registerProfile(upgraded);

    expect(listProfiles().map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(listProfiles()[0]).toBe(upgraded);
  });

  test("the empty string is a usable id — a falsy id is still an id", () => {
    // Guards against anyone replacing the Map miss check with `if (!profile)`
    // style truthiness on the *id*.
    const p = profile("");
    registerProfile(p);

    expect(getProfile("")).toBe(p);
    expect(tryGetProfile("")).toBe(p);
    expect(listProfiles()).toEqual([p]);
  });

  test("stores by reference: later edits to the profile object are visible through the registry", () => {
    // No defensive copy is made. Encoded because the server hydrates a profile
    // once and the dashboard reads role metadata off the same object.
    const p = profile("deye-sg05lp3");
    registerProfile(p);
    p.metrics.push(metric({ key: "grid.power", role: "grid.power", addresses: [20] }));

    expect(getProfile("deye-sg05lp3").metrics.map((m) => m.role)).toEqual([
      "pv.total.power",
      "battery.soc",
      "setting.work_mode",
      "grid.power",
    ]);
  });
});

describe("getProfile", () => {
  test("returns the exact registered object, role metadata intact", () => {
    const p = profile("deye-sg05lp3");
    registerProfile(p);
    const got = getProfile("deye-sg05lp3");

    expect(got).toBe(p);
    // The dashboard resolves every widget by role, so role/index/enum metadata
    // must survive a registry round-trip untouched.
    expect(got.metrics.find((m) => m.key === "battery.soc")?.role).toBe("battery.soc");
    expect(got.metrics.find((m) => m.key === "setting.work_mode")?.enumLabels).toEqual({
      0: "Selling First",
      1: "Zero Export",
    });
  });

  test("an unknown id throws and names the installed ids so the operator can see the typo", () => {
    registerProfile(profile("deye-sg05lp3"));
    registerProfile(profile("solis-s6"));

    expect(() => getProfile("deye-sg04lp3")).toThrow(
      'unknown inverter profile "deye-sg04lp3". Installed: deye-sg05lp3, solis-s6',
    );
  });

  test("with nothing installed the error says so rather than showing an empty list", () => {
    expect(() => getProfile("deye-sg05lp3")).toThrow(
      'unknown inverter profile "deye-sg05lp3". Installed: (none installed)',
    );
  });

  test("lookup is exact — case and surrounding whitespace are not normalized", () => {
    registerProfile(profile("deye-sg05lp3"));

    expect(() => getProfile("Deye-SG05LP3")).toThrow(/unknown inverter profile/);
    expect(() => getProfile(" deye-sg05lp3 ")).toThrow(/unknown inverter profile/);
    // The control: `not.toThrow()` would pass on any non-throwing return,
    // including a wrong or empty profile. Name what the exact id resolves to.
    expect(getProfile("deye-sg05lp3").id).toBe("deye-sg05lp3");
  });

  test("an id that is a JS object-prototype key is not a phantom hit", () => {
    // A Map, not a plain object: "constructor"/"toString" must miss, not return
    // a function masquerading as a profile.
    expect(() => getProfile("constructor")).toThrow(/unknown inverter profile/);
    expect(tryGetProfile("toString")).toBeUndefined();
    expect(tryGetProfile("__proto__")).toBeUndefined();
  });
});

describe("tryGetProfile", () => {
  test("returns undefined for a missing id instead of throwing", () => {
    registerProfile(profile("deye-sg05lp3"));

    expect(tryGetProfile("nope")).toBeUndefined();
  });

  test("returns undefined — not null — so `=== undefined` checks hold", () => {
    // absent vs empty vs null are different things; the boot path branches on
    // `undefined` when the configured active profile is not installed.
    const missing = tryGetProfile("nope");
    expect(missing).toBeUndefined();
    expect(missing).not.toBeNull();
  });

  test("returns the same object getProfile would", () => {
    const p = profile("deye-sg05lp3");
    registerProfile(p);

    expect(tryGetProfile("deye-sg05lp3")).toBe(getProfile("deye-sg05lp3"));
  });

  test("stops resolving an id once it is unregistered", () => {
    const p = profile("deye-sg05lp3");
    registerProfile(p);
    unregisterProfile("deye-sg05lp3");

    expect(tryGetProfile("deye-sg05lp3")).toBeUndefined();
  });
});

describe("listProfiles", () => {
  test("an empty registry lists an empty array, not undefined", () => {
    expect(listProfiles()).toEqual([]);
  });

  test("preserves registration order", () => {
    registerProfile(profile("b"));
    registerProfile(profile("a"));
    registerProfile(profile("c"));

    expect(listProfiles().map((p) => p.id)).toEqual(["b", "a", "c"]);
  });

  test("returns a fresh array — mutating it cannot corrupt the registry", () => {
    // Callers sort/filter the list for the picker; a live view would let a
    // `.sort()` or `.pop()` in the UI layer silently uninstall a profile.
    const p = profile("deye-sg05lp3");
    registerProfile(p);

    const first = listProfiles();
    first.pop();
    first.push(profile("bogus"));

    expect(listProfiles()).toEqual([p]);
    expect(listProfiles()).not.toBe(first);
  });
});

describe("unregisterProfile", () => {
  test("reports true when it removed something and false when there was nothing to remove", () => {
    registerProfile(profile("deye-sg05lp3"));

    expect(unregisterProfile("deye-sg05lp3")).toBe(true);
    expect(unregisterProfile("deye-sg05lp3")).toBe(false);
  });

  test("removing an id that was never installed is a no-op, not an error", () => {
    registerProfile(profile("deye-sg05lp3"));

    expect(unregisterProfile("never-installed")).toBe(false);
    expect(listProfiles().map((p) => p.id)).toEqual(["deye-sg05lp3"]);
  });

  test("removes only the named profile and leaves the rest in order", () => {
    registerProfile(profile("a"));
    registerProfile(profile("b"));
    registerProfile(profile("c"));

    expect(unregisterProfile("b")).toBe(true);
    expect(listProfiles().map((p) => p.id)).toEqual(["a", "c"]);
  });

  test("after removal getProfile throws again and no longer lists the id as installed", () => {
    registerProfile(profile("a"));
    registerProfile(profile("b"));
    unregisterProfile("a");

    expect(() => getProfile("a")).toThrow('unknown inverter profile "a". Installed: b');
  });

  test("a re-registered id resolves again after being unregistered", () => {
    const p = profile("deye-sg05lp3");
    registerProfile(p);
    unregisterProfile("deye-sg05lp3");
    registerProfile(p);

    expect(getProfile("deye-sg05lp3")).toBe(p);
    expect(listProfiles()).toHaveLength(1);
  });
});

describe("createInverter", () => {
  test("simulate: true builds a simulator and never touches the connection details", () => {
    const p = profile("deye-sg05lp3");
    const source = createInverter(p, { simulate: true, connection });

    expect(source).toBeInstanceOf(SimulatedInverter);
    expect(source.profile).toBe(p);
  });

  test("simulate: false builds the real Modbus source bound to the same profile", () => {
    // Constructing the driver only plans reads; it does not open a socket.
    const p = profile("deye-sg05lp3");
    const source = createInverter(p, { simulate: false, connection });

    expect(source).toBeInstanceOf(ModbusInverter);
    expect(source.profile).toBe(p);
  });

  test("takes the profile object, so an unregistered profile still yields a source", () => {
    // createInverter deliberately does not consult the registry — the server
    // may build a source from a freshly hydrated profile before install.
    const p = profile("not-registered");
    expect(tryGetProfile("not-registered")).toBeUndefined();

    expect(createInverter(p, { simulate: true, connection }).profile.id).toBe("not-registered");
  });

  test("each call yields an independent source for the same profile", () => {
    const p = profile("deye-sg05lp3");

    expect(createInverter(p, { simulate: true, connection })).not.toBe(
      createInverter(p, { simulate: true, connection }),
    );
  });

  test("a simulated source read reports the registry id and every non-computed metric", async () => {
    const p = profile("deye-sg05lp3");
    registerProfile(p);
    const sample = await createInverter(getProfile("deye-sg05lp3"), {
      simulate: true,
      connection,
    }).read();

    expect(sample.inverterId).toBe("deye-sg05lp3");
    expect(Object.keys(sample.metrics).sort()).toEqual([
      "battery.soc",
      "pv.total.power",
      "setting.work_mode",
    ]);
    // 0 is a legitimate reading (night-time PV); presence must be asserted by
    // key, never by truthiness of the value.
    for (const key of Object.keys(sample.metrics)) {
      expect(Number.isFinite(sample.metrics[key])).toBe(true);
    }
  });
});
