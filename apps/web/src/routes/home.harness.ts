// What the home route's tests serve: a fake core behind fetch, and the browser state they reset.

import { expect, vi } from "vitest";
import { page } from "vitest/browser";
import type { Layout } from "../lib/api/core.ts";
import { motion } from "../lib/motion/tier.svelte.ts";
import { setLocale } from "../lib/paraglide/runtime.js";

const DASHBOARD = "sunreye.dashboard";
const LOW_POWER = "sunreye.low-power";

/** A 10 m × 8 m gable house with nothing on its roof. */
const withScene: Layout = {
  appliesFrom: "2026-11-01T00:00:00Z",
  strings: [],
  warnings: [],
  scene: {
    north: 0,
    blocks: [
      { x: 0, z: 0, width: 10, depth: 8, eave: 3, rotation: 0, roof: { kind: "gable", pitch: 35 } },
    ],
    obstacles: [],
  },
};

const pass = globalThis.fetch.bind(globalThis);

/** The paths the page asked the core for, in order. */
const paths: string[] = [];

const INVERTER = { id: 1, name: "Wechselrichter", profile: "deye-sg05lp3", connection: 1, unit: 1 };

interface Served {
  scene: boolean;
  /** Signed in when undefined, Home Assistant's ingress too. */
  session: "auth.setup" | "auth.required" | undefined;
  devices: readonly unknown[];
  live: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

/** What the core serves: the layout with a scene once a test says so, the session and devices. */
export const served: Served = { scene: false, session: undefined, devices: [INVERTER], live: {} };

function problem(status: number, code: string): Response {
  return Response.json(
    { status, code },
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

const SCAN = {
  subnet: "192.168.1.0/24",
  endpoints: [
    {
      transport: "modbus-tcp",
      host: "192.168.1.20",
      port: 502,
      devices: [{ profile: "deye-sg05lp3", unit: 1 }],
    },
  ],
};

/** What a fresh core answers to the first run's writes, by method and path. */
function configure(call: string): Response | undefined {
  if (call === "POST /api/v1/setup") served.session = "auth.required";

  if (call === "POST /api/v1/login") served.session = undefined;

  if (call === "POST /api/v1/devices") served.devices = [INVERTER];

  const answers = new Map([
    ["POST /api/v1/scan", () => Response.json(SCAN)],
    ["POST /api/v1/connections", () => Response.json({ id: 1, secrets: [] }, { status: 201 })],
    ["POST /api/v1/devices", () => Response.json(INVERTER, { status: 201 })],
  ]);

  // Every other write succeeds; the first run reads no answer back.
  return call.startsWith("GET ") ? undefined : (answers.get(call)?.() ?? Response.json({}));
}

/** The core's answer at `pathname`. */
function answer(pathname: string): Response | undefined {
  switch (pathname) {
    case "/api/v1/session":
      return served.session === undefined
        ? new Response(null, { status: 204 })
        : problem(401, served.session);
    case "/api/v1/devices":
      return Response.json({ devices: served.devices });
    case "/api/v1/layout":
      return served.scene
        ? Response.json(withScene)
        : Response.json({ status: 404, code: "layout.none" }, { status: 404 });
    case "/api/v1/module-types":
      return Response.json({ moduleTypes: [] });
    case "/api/v1/capabilities":
      return Response.json({ code: "auth.required" }, { status: 401 });
    case "/api/v1/live":
      // The snapshot, then a stream held open: one that ends reconnects at once.
      return new Response(
        new ReadableStream({
          start: (controller) => {
            controller.enqueue(
              new TextEncoder().encode(
                `event: snapshot\ndata: ${JSON.stringify({ devices: served.live })}\n\n`,
              ),
            );
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    default:
      return undefined;
  }
}

/** Waits until the page asked the core for `path` and a frame passed for its answer to show. */
export async function asked(path: string): Promise<void> {
  await expect
    .poll(() => {
      return paths.includes(path);
    })
    .toBe(true);
  await new Promise<void>((painted) => {
    requestAnimationFrame(() => {
      painted();
    });
  });
}

/** Serves the fake core at a laptop's size, every switch reset. */
export async function serveCore(): Promise<void> {
  localStorage.removeItem(DASHBOARD);
  localStorage.removeItem(LOW_POWER);
  paths.length = 0;
  served.scene = false;
  served.session = undefined;
  served.devices = [INVERTER];
  served.live = {};
  // The core answers the API; everything else, the WASM too, passes through.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- fetch's own parameters are mutable.
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    const method = input instanceof Request ? input.method : "GET";

    paths.push(url.pathname);

    return Promise.resolve(
      configure(`${method} ${url.pathname}`) ?? answer(url.pathname) ?? pass(input, init),
    );
  });
  await page.viewport(1280, 900);
}

export async function restoreCore(): Promise<void> {
  vi.restoreAllMocks();
  motion.lowPower = false;
  await setLocale("de", { reload: false });
}
