import "../../app.css";
import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type SurroundingsStatus, type Transport } from "../api/core.ts";
import Builder from "./Builder.svelte";
import {
  desk,
  DEVICES,
  drill,
  house,
  inspector,
  MODULE,
  onCanvas,
  press,
  pv,
  starts,
  undesk,
} from "./builder.harness.ts";
import type { Imported } from "./imported.ts";

const SLOW = { timeout: 20_000 };

const ID = "ab".repeat(32);

/** A flat-roofed building 6 m high over a rectangle. */
const building = (id: number, west: number, east: number) => ({
  id,
  outline: [
    [west, -9],
    [east, -9],
    [east, 1],
    [west, 1],
  ],
  eave: 6,
  roof: { kind: "flat" as const },
});

/** The building under the 10 m by 8 m house, a neighbour 15 m east of it, on level ground. */
const DOCUMENT: Imported = {
  radius: 100,
  buildings: [building(0, -0.5, 10.5), building(1, 25, 35)],
  trees: [{ at: [-12, -4], height: 8, radius: 2.4, crown: "broadleaf" }],
  hedges: [],
  grounds: [
    {
      finish: "road",
      outline: [
        [-100, 14],
        [100, 14],
      ],
      width: 6,
    },
  ],
  terrain: { step: 100, side: 3, heights: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
  credits: ["© OpenStreetMap contributors", "Europe terrain data produced using Copernicus data"],
};

const READY: SurroundingsStatus = { state: "ready", document: ID };

/** A core that fetches surroundings: a load answers at once, the status `ended` from then on. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the core's own answer.
function surveyed(ended: SurroundingsStatus = READY) {
  const loads: unknown[] = [];
  const puts: unknown[] = [];

  const transport: Transport = {
    base: "http://core.test/",
    fetch: async (request) => {
      const { pathname } = new URL(request.url);

      if (pathname === "/api/v1/surroundings" && request.method === "POST") {
        loads.push(await request.json());

        return Response.json({ state: "fetching" }, { status: 202 });
      }

      if (pathname === "/api/v1/surroundings") return Response.json(ended);

      if (pathname === `/api/v1/surroundings/${ID}`) return Response.json(DOCUMENT);

      if (request.method === "PUT") {
        puts.push(await request.json());

        return Response.json({ appliesFrom: "2026-10-31T23:00:00Z", strings: [] });
      }

      // The live stream stays open and silent.
      return Promise.withResolvers<Response>().promise;
    },
  };

  return { transport, loads, puts };
}

async function builder(transport: Transport) {
  const screen = await render(Builder, {
    pv,
    core: connect(transport),
    start: house(),
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await drill("Umgebung", "Umgebung aus Kartendaten");

  return screen;
}

const undo = () => inspector().getByRole("button", { name: "Rückgängig" }).click();

const row = (label: string) => inspector().getByRole("button", { name: starts(`${label} `) });

/** A row's value, after its label. */
const value = (label: string) => () => row(label).element().textContent.replace(label, "").trim();

/** How many imported buildings the level says are hidden. */
const hidden = () =>
  inspector()
    .getByText("Ausgeblendete Gebäude")
    .element()
    .closest("[data-slot=item]")
    ?.textContent.match(/\d+/u)?.[0];

/** Loads the surroundings and waits for their level. */
async function loaded(): Promise<void> {
  await inspector().getByRole("button", { name: "Umgebung laden" }).click();
  await expect.element(row("Position x (m)"), SLOW).toBeVisible();
}

beforeEach(async () => {
  localStorage.removeItem("sunreye.builder.view");
  await desk();
});

afterEach(async () => {
  await undesk();
});

test("the admin loads surroundings for a radius, told where the location goes; undo takes them away", async () => {
  const { transport, loads, puts } = surveyed();
  const screen = await builder(transport);

  await expect
    .element(screen.getByText(/an OpenStreetMap \(Overpass\).*an Terrain Tiles/u))
    .toBeVisible();
  await expect.poll(value("Umkreis")).toBe("200 m");

  await loaded();

  expect(loads).toEqual([{ radius: 200 }]);
  // The building under the house is hidden from the start.
  await expect.poll(hidden).toBe("1");
  await expect.element(inspector().getByRole("button", { name: "Alle einblenden" })).toBeEnabled();
  // The credits lie on the canvas while the surroundings are drawn.
  await expect
    .element(screen.getByLabelText("Datenquellen der Umgebung"))
    .toHaveTextContent(
      "© OpenStreetMap contributors · Europe terrain data produced using Copernicus data",
    );

  await inspector().getByRole("button", { name: "Speichern" }).click();
  await expect.poll(() => puts.length, SLOW).toBe(1);
  expect(puts[0]).toMatchObject({
    scene: { imported: { document: ID, x: 0, z: 0, turn: 0, hidden: [0] } },
  });
});

test("loading is one undo step, and so is removing", async () => {
  const { transport } = surveyed();
  const screen = await builder(transport);
  await loaded();
  await undo();

  await expect.element(inspector().getByRole("button", { name: "Umgebung laden" })).toBeVisible();
  expect(screen.getByLabelText("Datenquellen der Umgebung").query()).toBeNull();

  await inspector().getByRole("button", { name: "Wiederholen" }).click();
  await inspector().getByRole("button", { name: "Entfernen" }).click();

  await expect.poll(() => screen.getByLabelText("Datenquellen der Umgebung").query()).toBeNull();

  await undo();
  await expect.element(screen.getByLabelText("Datenquellen der Umgebung")).toBeVisible();
});

test("a more exact centre goes with the load, and one that is no place holds the load back", async () => {
  const { transport, loads } = surveyed();

  await builder(transport);

  await userEvent.fill(page.getByLabelText("Breitengrad"), "48,137");

  await expect.element(inspector().getByRole("button", { name: "Umgebung laden" })).toBeDisabled();
  await expect
    .element(inspector().getByRole("alert"))
    .toHaveTextContent(
      "Breitengrad von −90 bis 90 und Längengrad von −180 bis 180 angeben, oder beide Felder leer lassen.",
    );

  await userEvent.fill(page.getByLabelText("Längengrad"), "11.575");
  await loaded();

  expect(loads).toEqual([{ radius: 200, latitude: 48.137, longitude: 11.575 }]);
});

test("a failed load says why and leaves the scene as it was", async () => {
  const { transport } = surveyed({ state: "failed", error: "overpass: 504 Gateway Timeout" });

  await builder(transport);
  await inspector().getByRole("button", { name: "Umgebung laden" }).click();

  await expect
    .element(inspector().getByRole("alert"), SLOW)
    .toHaveTextContent("Die Umgebung konnte nicht geladen werden: overpass: 504 Gateway Timeout");
  await expect.element(inspector().getByRole("button", { name: "Umgebung laden" })).toBeEnabled();
  await expect.element(inspector().getByRole("button", { name: "Rückgängig" })).toBeDisabled();
});

test("the knob drags the surroundings into place, one undo step", async () => {
  const { transport } = surveyed();

  await builder(transport);
  await loaded();

  const on = onCanvas(house().scene);
  const [from, to] = [on([0, 0, 0]), on([5, 0, 3])];

  await press("mouse", [from, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], to]);

  await expect.poll(value("Position x (m)")).toBe("5");
  await expect.poll(value("Position z (m)")).toBe("3");

  await undo();
  await expect.poll(value("Position x (m)")).toBe("0");
});

test(
  "a tap on an imported building hides it, and another on its ghost shows it again",
  { timeout: 60_000 },
  async () => {
    const { transport } = surveyed();
    // From high in the south-east, the house and its neighbour both in view.
    const view = { position: [30, 70, 60], target: [17, 0, 4] } as const;

    localStorage.setItem("sunreye.builder.view", JSON.stringify(view));
    await builder(transport);
    await loaded();

    // The neighbour's flat roof, 30 m east and 4 m north of the house's corner.
    const neighbour = onCanvas(house().scene, view)([30, 6, 4]);

    // The surroundings come once the house is on screen: until then a tap strikes the lawn.
    await expect
      .poll(
        async () => {
          if (hidden() !== "2") await press("mouse", [neighbour]);

          return hidden();
        },
        { timeout: 50_000, interval: 1000 },
      )
      .toBe("2");

    await press("mouse", [neighbour]);
    await expect.poll(hidden).toBe("1");
  },
);
