/// <reference types="bun" />
// The reads that rarely change, through `connect`: one request for every caller until a change.
import { expect, setSystemTime, test } from "bun:test";
import { connect, type Core } from "./core.ts";
import type { Visibility } from "./live.ts";
import { problem, tally } from "./core.harness.ts";

const LAYOUT = { appliesFrom: "2026-11-01T00:00:00Z", strings: [], warnings: [] };

type Answer = () => Response | Promise<Response>;

/** What the fake core answers at a path; the rest succeed with an empty body. */
const ANSWERS: readonly (readonly [string, Answer])[] = [
  ["/api/v1/devices", () => Response.json({ devices: [] })],
  ["/api/v1/layout", () => Response.json(LAYOUT)],
  ["/api/v1/capabilities", () => Response.json({ devices: {} })],
  ["/api/v1/timezone", () => Response.json({ name: "Europe/Berlin" })],
  ["/api/v1/series", () => Response.json({ devices: [] })],
  ["/api/v1/topology", () => Response.json({ appliesFrom: LAYOUT.appliesFrom, points: [] })],
  ["/api/v1/module-types", () => Response.json({ moduleTypes: [] })],
  ["/api/v1/location", () => Response.json({ latitude: 52.5, longitude: 13.4 })],
];

/** A core whose `GET` answers can be swapped, with every GET it was asked by path; every write
 * succeeds. */
function fake(page?: Visibility) {
  const urls: string[] = [];
  const answers = new Map(ANSWERS);

  const core = connect(
    {
      base: "http://core.test/",
      fetch: (request) => {
        const { pathname } = new URL(request.url);

        if (request.method !== "GET") return Promise.resolve(new Response(null, { status: 204 }));

        // The reads under test alone.
        if (ANSWERS.some(([path]) => path === pathname)) urls.push(request.url);

        return Promise.resolve(answers.get(pathname)?.() ?? new Response(null, { status: 204 }));
      },
    },
    page,
  );

  return { core, answers, asked: () => tally(urls) };
}

async function readAll(core: Readonly<Core>): Promise<void> {
  await Promise.all([
    core.devices(),
    core.layout(),
    core.capabilities(),
    core.timezone(),
    core.series(),
    core.topology(),
    core.moduleTypes(),
    core.location(),
  ]);
}

const EVERY = [
  "devices",
  "layout",
  "capabilities",
  "timezone",
  "series",
  "topology",
  "module-types",
  "location",
];

const ONCE = Object.fromEntries(EVERY.map((path) => [path, 1]));

test("callers at once share one request, and a later caller none", async () => {
  const { core, asked } = fake();

  const [first, second] = await Promise.all([core.layout(), core.layout()]);
  const third = await core.layout();

  expect(first).toEqual(LAYOUT);
  expect(second).toEqual(LAYOUT);
  expect(third).toEqual(LAYOUT);
  expect(asked()).toEqual({ layout: 1 });
});

test("every rarely changing read is asked once", async () => {
  const { core, asked } = fake();

  await readAll(core);
  await readAll(core);

  expect(asked()).toEqual(ONCE);
});

const NOW = "2026-11-12T00:00:00Z";

const DRAFT = { connection: 1, profile: "p", name: "n", unit: 1 } as const;

const DATASHEET = {
  name: "M",
  pmax: 400,
  vmp: 34,
  imp: 11.8,
  voc: 41,
  isc: 12.5,
  powerCoefficient: -0.35,
  voltageCoefficient: -0.27,
  currentCoefficient: 0.05,
  bypassDiodes: 3,
  width: 1.1,
  height: 1.7,
};

type Change = (core: Readonly<Core>) => Promise<object | undefined>;

/** Each write and the reads it changes: the next of those asks the core again. */
const CHANGES: readonly (readonly [string, Change, readonly string[]])[] = [
  [
    "a layout change",
    (core) =>
      core.changeLayout({
        appliesFrom: NOW,
        strings: [],
        scene: { north: 0, blocks: [], obstacles: [] },
      }),
    ["layout", "capabilities"],
  ],
  ["a new module type", (core) => core.addModuleType(DATASHEET), ["module-types"]],
  ["a new timezone", (core) => core.setTimezone("UTC"), ["timezone"]],
  ["a new location", (core) => core.setLocation({ latitude: 1, longitude: 2 }), ["location"]],
  [
    "a topology change",
    (core) => core.changeTopology({ appliesFrom: NOW, points: [] }),
    ["topology", "capabilities", "series"],
  ],
  ["an enable", (core) => core.enable(1, "k", true), ["capabilities"]],
  ["an import", (core) => core.startImport("a", []), ["series"]],
  // An import in progress writes series until it is done.
  ["an import's progress", (core) => core.importStatus(), ["series"]],
  // Who asks, or what is registered: every read.
  ["a sign-in", (core) => core.signIn("pw"), EVERY],
  ["the first password", (core) => core.setPassword("pw"), EVERY],
  ["a new device", (core) => core.addDevice(DRAFT), EVERY],
  ["a changed device", (core) => core.changeDevice(1, DRAFT), EVERY],
  ["a removed device", (core) => core.removeDevice(1), EVERY],
  ["an applied profile update", (core) => core.apply("p"), EVERY],
];

for (const [name, write, changed] of CHANGES) {
  test(`${name} asks again for what it changes, and only that`, async () => {
    const { core, asked } = fake();

    await readAll(core);
    await write(core);
    await readAll(core);

    expect(asked()).toEqual({ ...ONCE, ...Object.fromEntries(changed.map((path) => [path, 2])) });
  });
}

test("a read in flight while a change lands is not kept", async () => {
  const { core, answers, asked } = fake();
  const held = Promise.withResolvers<Response>();

  answers.set("/api/v1/timezone", () => held.promise);

  const before = core.timezone();

  await core.setTimezone("UTC");
  answers.set("/api/v1/timezone", () => Response.json({ name: "UTC" }));
  held.resolve(Response.json({ name: "Europe/Berlin" }));

  expect(await before).toEqual({ name: "Europe/Berlin" });
  expect(await core.timezone()).toEqual({ name: "UTC" });
  expect(asked()).toEqual({ timezone: 2 });
});

test("a viewer's refusal is kept; any other refusal or a failed request is asked again", async () => {
  const { core, answers, asked } = fake();

  answers.set("/api/v1/devices", () => problem(403, "auth.forbidden"));
  answers.set("/api/v1/series", () => problem(404, "not.found"));
  answers.set("/api/v1/layout", () => new Response("Bad Gateway", { status: 502 }));
  answers.set("/api/v1/timezone", () => Promise.reject(new TypeError("offline")));

  const twice = async () => {
    expect(await core.devices()).toEqual({ problem: "auth.forbidden" });
    expect(await core.series()).toEqual({ problem: "not.found" });
    expect(await core.layout()).toEqual({ problem: "http.502" });
    expect(await core.timezone().catch(() => "failed")).toBe("failed");
  };

  await twice();
  await twice();

  expect(asked()).toEqual({ devices: 1, series: 2, layout: 2, timezone: 2 });
});

/** A page whose visibility the test flips. */
class Page extends EventTarget {
  hidden = false;

  show(visible: boolean): void {
    this.hidden = !visible;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

test("a page shown again asks again: another screen may have changed the plant", async () => {
  const page = new Page();
  const { core, asked } = fake(page);

  await core.layout();
  page.show(false);
  await core.layout();
  page.show(true);
  await core.layout();

  expect(asked()).toEqual({ layout: 2 });
});

test("the series catalog is asked again once its last instants are minutes old", async () => {
  setSystemTime(new Date("2026-11-12T12:00:00Z"));

  try {
    const { core, asked } = fake();

    await core.series();
    setSystemTime(new Date("2026-11-12T12:04:59Z"));
    await core.series();
    await core.layout();
    setSystemTime(new Date("2026-11-12T12:05:01Z"));
    await core.series();
    await core.layout();

    expect(asked()).toEqual({ series: 2, layout: 1 });
  } finally {
    setSystemTime();
  }
});
