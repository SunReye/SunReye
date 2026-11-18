import "../../app.css";
import { beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import { Studio } from "../scene/studio.ts";
import Builder from "./Builder.svelte";
import { DEVICES, house, inspector, MODULE, pv } from "./builder.harness.ts";

// The builder's weather (ADR 23 "Builder"): the dashboard's until the admin edits.

const QUARTER = 15 * 60_000;

/** A core whose weather forecast is 1 in every series through the span asked: a metre of
 * visibility and snowfall. Nothing is measured, and the live stream stays silent. */
const snowedIn: Transport = {
  base: "http://core.test/",
  fetch: (request) => {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/history")) {
      return Promise.resolve(Response.json({ tier: "raw", points: [] }));
    }

    if (!url.pathname.endsWith("/forecasts")) return Promise.withResolvers<Response>().promise;

    const from = Date.parse(url.searchParams.get("from") ?? "");
    const to = Date.parse(url.searchParams.get("to") ?? "");
    const points = [];

    for (let at = from; at < to; at += QUARTER) {
      points.push({
        issued: new Date(from).toISOString(),
        target: new Date(at).toISOString(),
        value: 1,
      });
    }

    return Promise.resolve(Response.json({ points }));
  },
};

beforeEach(async () => {
  await page.viewport(1280, 900);
});

test("the builder shows the instant's fog until a block is picked to edit, and lying snow throughout", async () => {
  const lighted = vi.spyOn(Studio.prototype, "light");
  const weather = () => lighted.mock.lastCall?.[3];

  await render(Builder, {
    pv,
    core: connect(snowedIn),
    start: house(),
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await expect.poll(weather, { timeout: 15_000 }).toMatchObject({ fog: 1, wet: 1, snow: true });

  // The isometric view looks at the house's middle.
  await page.getByLabelText("3D-Szene des Hauses").click();
  await expect.element(inspector().getByRole("heading", { name: "Baukörper 1" })).toBeVisible();
  await expect.poll(weather, { timeout: 15_000 }).toMatchObject({ fog: 0, wet: 0, snow: true });

  lighted.mockRestore();
});

test("a sample weather from the weather button stands in for the stored one until the stored is picked again", async () => {
  const lighted = vi.spyOn(Studio.prototype, "light");
  const weather = () => lighted.mock.lastCall?.[3];

  await render(Builder, {
    pv,
    core: connect(snowedIn),
    start: house(),
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await expect.poll(weather, { timeout: 15_000 }).toMatchObject({ fog: 1, snow: true });

  await page.getByRole("button", { name: "Wetter" }).click();
  await page.getByRole("menuitemradio", { name: "Gewitter" }).click();
  // The pick closes the menu.
  await expect.element(page.getByRole("menu")).not.toBeInTheDocument();

  await expect.poll(weather, { timeout: 15_000 }).toMatchObject({
    fog: 0,
    wet: 1,
    snow: false,
    thunder: true,
    falling: { kind: "rain" },
  });

  await page.getByRole("button", { name: "Wetter" }).click();
  await expect.element(page.getByRole("menuitemradio", { name: "Gewitter" })).toBeChecked();
  await page.getByRole("menuitemradio", { name: "Gespeichert" }).click();

  await expect.poll(weather, { timeout: 15_000 }).toMatchObject({ fog: 1, snow: true });

  lighted.mockRestore();
});
