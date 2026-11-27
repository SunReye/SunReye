// The settings screen's test core, shared by its component tests.
import type { Attempt, Capabilities, Transport } from "../api/core.ts";
import { json } from "../api/core.harness.ts";

export const CHARGE = "battery.max_charge_current";

/** A profile's settings as the core's capabilities list them; no brand anywhere. */
export const CAPABILITIES: Capabilities & {
  readonly devices: { readonly "3": Capabilities["devices"][string] };
} = {
  version: "5.0.0",
  schema: { min: 1, max: 1 },
  capabilities: [],
  transports: [],
  devices: {
    "3": {
      estimated: [],
      series: [],
      writes: true,
      settings: [
        { key: CHARGE, range: { min: 0, max: 350 }, step: 1, enable: "on" },
        { key: "work_mode", values: [0, 1, 2], step: 1, enable: "on" },
        {
          key: "ev.mode",
          values: [0, 1, 2, 3],
          labels: [
            { value: 0, text: "off" },
            { value: 1, text: "now" },
            { value: 2, text: "minpv" },
            { value: 3, text: "pv" },
          ],
          step: 1,
          enable: "community",
        },
      ],
    },
  },
};

/** The device behind CAPABILITIES' "3", as the core lists it. */
export const DEVICE = {
  id: 3,
  connection: 1,
  name: "Wechselrichter",
  profile: "hybrid-test",
  unit: 1,
  writes: true,
};

export function attempt(fields: Readonly<Partial<Attempt>>): Attempt {
  return {
    time: "2026-11-09T08:00:00Z",
    device: 3,
    setting: CHARGE,
    before: 108,
    requested: 50,
    after: 50,
    outcome: "verified",
    failedStep: null,
    actor: "admin",
    ...fields,
  };
}

/** What the test core always answers the same, by path. */
const FIXED = new Map([
  ["/api/v1/capabilities", () => json("Support", CAPABILITIES)],
  ["/api/v1/devices", () => json("DeviceList", { devices: [DEVICE] })],
  ["/api/v1/connections", () => json("Connections", { connections: [] })],
  ["/api/v1/profiles", () => json("Catalogue", { profiles: [] })],
  ["/api/v1/profile-updates", () => json("Updates", { updates: [] })],
  // No import has run, and none is offered.
  ["/api/v1/import", () => json("ImportStatus", { state: "idle", done: 0, total: 0 })],
  ["/api/v1/import/files", () => json("ArchiveFiles", { files: [] })],
]);

/** A test core: capabilities as above, the write log and each write answered by the test. */
export function testCore(
  log: () => Response,
  write: () => Response = () => json("Entry", attempt({})),
  read: Readonly<Record<string, () => Response>> = {},
): Transport & { readonly writes: string[] } {
  const writes: string[] = [];

  return {
    base: "http://core.test/",
    writes,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      const answer = request.method === "GET" ? read[path] : undefined;

      if (answer !== undefined) return answer();

      if (path === "/api/v1/writes") return log();

      const fixed = FIXED.get(path);

      if (fixed !== undefined) return fixed();

      writes.push(`${request.method} ${path} ${await request.text()}`);

      return write();
    },
  };
}
