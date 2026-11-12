// The settings screen's test core, shared by its component tests.
import type { Attempt, Transport } from "../api/core.ts";

export const CHARGE = "battery.max_charge_current";

/** A setting's row, named by its key (no name is declared) and the value it last read back. */
export function row(key: string, value = "") {
  return { name: `${key} ${value}`.trim(), exact: true } as const;
}

/** A profile's settings as the core's capabilities list them; no brand anywhere. */
export const CAPABILITIES = {
  version: "5.0.0",
  schema: { min: 1, max: 1 },
  capabilities: [],
  transports: [],
  devices: {
    "3": {
      estimated: [],
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

export function problem(status: number, code: string): Response {
  return Response.json(
    { status, code },
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

/** A test core: capabilities as above, the write log and each write answered by the test. */
export function testCore(
  log: () => Response,
  write: () => Response = () => Response.json(attempt({})),
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

      if (path === "/api/v1/capabilities") return Response.json(CAPABILITIES);

      if (path === "/api/v1/writes") return log();

      if (path === "/api/v1/profile-updates") return Response.json({ updates: [] });

      // No import has run, and none is offered.
      if (path === "/api/v1/import") return Response.json({ state: "idle", done: 0, total: 0 });

      if (path === "/api/v1/import/files") return Response.json({ files: [] });

      writes.push(`${request.method} ${path} ${await request.text()}`);

      return write();
    },
  };
}
