import "../../app.css";
import { afterEach, beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type Core } from "../api/core.ts";
import { setLocale } from "../paraglide/runtime.js";
import Builder from "./Builder.svelte";
import { DEVICES, house, MODULE, phone, pv, tap, testCore, undesk } from "./builder.harness.ts";
import { unfaded } from "../scroll-fade.harness.ts";

// The phone builder's zones (ADR 20): the time and the views along the top, one status strip and
// the tools above the peeking inspector, and the shell's bar under it all. Nothing overlaps.

/** The shell's bottom bar on a phone: 84 px, which the shell hands down as `--bar-clear`. */
const BAR = 84;

const NAMES = {
  de: {
    moment: "Zeitpunkt",
    views: "Ansichten",
    status: "Jetzt in der Szene",
    tools: "Werkzeuge",
    sheet: "Szene bearbeiten",
    strings: "Strings",
    save: "Speichern",
  },
  en: {
    moment: "Moment",
    views: "Views",
    status: "In the scene now",
    tools: "Tools",
    sheet: "Edit the scene",
    strings: "Strings",
    save: "Save",
  },
} as const;

type Locale = keyof typeof NAMES;

const string = (id: number, name: string) => ({
  id,
  name,
  moduleType: MODULE.id,
  device: 1,
  input: id,
  modules: 16,
  optimized: 0,
  tilt: 25,
  azimuth: 15,
  loss: 2,
});

/** A live stream that says once: the wallbox's car is connected, at 43 %. */
const live: Core["live"] = (listener) => {
  listener({
    devices: { "3": { "ev.connected": 1, "ev.charge.power": 0, "ev.vehicle.soc": 43 } },
  });

  return () => {};
};

const input = (n: number) => ({ device: 1, input: n, factors: [], recent: null });

/** A plant as full as the owner's: three strings, a connected car, two learned inputs. */
function full() {
  const draft = house();
  const place = { device: 3, x: -5, z: 1, width: 2.5, length: 5, rotation: 0 };
  const transport = testCore();

  const core = connect({
    ...transport,
    fetch: (request) =>
      request.url.endsWith("/corrections")
        ? Promise.resolve(Response.json({ inputs: [input(1), input(2)] }))
        : transport.fetch(request),
  });

  return {
    core: { ...core, live },
    start: {
      scene: { ...draft.scene, carPlaces: [place] },
      strings: [string(1, "M1S"), string(2, "M1N"), string(3, "M2S")],
    },
  };
}

let bar: HTMLElement | undefined;

/** Stands the shell's bar under the builder, as on a phone. */
function shell(): void {
  document.documentElement.style.setProperty("--bar-clear", `${String(BAR)}px`);
  bar = document.createElement("nav");
  bar.style.cssText = `position:fixed;inset:auto 0 0 0;height:${String(BAR)}px;z-index:40`;
  document.body.append(bar);
}

async function opened(locale: Locale, width: number, height: number) {
  await setLocale(locale, { reload: false });
  await phone();
  await page.viewport(width, height);
  shell();

  const screen = await render(Builder, {
    ...full(),
    pv,
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  const names = NAMES[locale];

  const zones = {
    moment: screen.getByRole("group", { name: names.moment }),
    views: screen.getByRole("button", { name: names.views }),
    status: screen.getByRole("group", { name: names.status }),
    tools: screen.getByRole("toolbar", { name: names.tools }),
    sheet: screen.getByRole("region", { name: names.sheet }),
  };

  await expect.element(zones.status).toMatchTextContent(/M2S/u);
  await expect.element(zones.status).toMatchTextContent(/43 %/u);

  return { screen, zones, names };
}

type Box = Readonly<{ name: string; left: number; top: number; right: number; bottom: number }>;

type Zones = Awaited<ReturnType<typeof opened>>["zones"];

/** The zones named in `shown`, each as far as it shows: above the bar. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- vitest's locators, read only.
function boxes(zones: Zones, shown: readonly (keyof Zones)[]): Box[] {
  return shown.map((name) => {
    const { left, top, right, bottom } = zones[name].element().getBoundingClientRect();

    return { name, left, top, right, bottom: Math.min(bottom, window.innerHeight - BAR) };
  });
}

/** Whether two boxes share a pixel. */
const touch = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Every pair of `all` that shares a pixel. */
function overlaps(all: readonly Box[]): string[] {
  return all.flatMap((a, i) =>
    all.slice(i + 1).flatMap((b) => (touch(a, b) ? [`${a.name} × ${b.name}`] : [])),
  );
}

beforeEach(() => {
  localStorage.removeItem("sunreye.builder.view");
});

afterEach(async () => {
  bar?.remove();
  document.documentElement.style.removeProperty("--bar-clear");
  await setLocale("de", { reload: false });
  await undesk();
  await page.viewport(1280, 900);
});

const SIZES = [
  ["de", 390, 844],
  ["en", 390, 844],
  ["de", 360, 740],
  ["en", 360, 740],
] as const;

test.for(SIZES)("no two overlays overlap (%s, %i×%i)", async ([locale, width, height]) => {
  const { zones, names } = await opened(locale, width, height);
  const peeking = boxes(zones, ["moment", "views", "status", "tools", "sheet"]);

  expect(overlaps(peeking)).toEqual([]);

  // Every zone lies on the screen, above the bar.
  for (const box of peeking) {
    expect(box.left, box.name).toBeGreaterThanOrEqual(0);
    expect(box.right, box.name).toBeLessThanOrEqual(width);
    expect(box.top, box.name).toBeLessThan(height - BAR);
  }

  // Pulled up, the inspector covers the lower zones: they are gone, not underneath.
  await tap(page.getByRole("button", { name: names.sheet }));
  await expect.poll(() => zones.tools.query()).toBeNull();
  await expect.poll(() => zones.status.query()).toBeNull();
  expect(overlaps(boxes(zones, ["moment", "views", "sheet"]))).toEqual([]);
});

test("the views are a closed menu until asked for", async () => {
  const { screen, zones } = await opened("de", 390, 844);

  expect(screen.getByRole("menuitem").query()).toBeNull();
  expect(screen.getByText("Norden").query()).toBeNull();

  await zones.views.click();

  await expect.element(page.getByRole("menuitem", { name: "Norden" })).toBeVisible();
  await expect.element(page.getByRole("menuitem", { name: "Isometrisch" })).toBeVisible();
});

test("no browser-default inputs: the day is picked in a calendar, the time on the registry's slider", async () => {
  const { names, zones } = await opened("de", 390, 844);

  await tap(page.getByRole("button", { name: names.sheet }));

  const plain = [
    ...document.querySelectorAll(
      "select, input[type=date], input[type=time], input[type=datetime-local], input[type=number], input[type=range], input[type=color]",
    ),
  ];

  expect(plain).toEqual([]);
  await expect
    .element(zones.moment.getByRole("slider", { name: "Uhrzeit" }))
    .toHaveAttribute("data-slot", "slider-thumb");

  await zones.moment.getByRole("button", { name: /^Tag: /u }).click();
  await expect
    .element(page.getByRole("application", { name: /^Tag /u }).getByRole("grid"))
    .toBeVisible();
});

test("the peeking inspector shows nothing under the bar, and pulled up its last row and save stay above it", async () => {
  const { zones, names } = await opened("de", 390, 844);
  const sheet = zones.sheet.element();

  // Behind the bar: nothing of the inspector hangs out below the builder.
  const under = document.elementsFromPoint(195, 844 - BAR / 2);

  expect(under.filter((element) => sheet.contains(element))).toEqual([]);

  await tap(page.getByRole("button", { name: names.sheet }));

  const last = zones.sheet.getByRole("button", { name: new RegExp(`^${names.strings}`, "u") });
  const save = zones.sheet.getByRole("button", { name: names.save });

  await expect.element(last).toBeVisible();
  last.element().scrollIntoView({ block: "nearest" });

  for (const control of [last, save]) {
    const box = control.element().getBoundingClientRect();
    const middle = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);

    expect(box.bottom).toBeLessThanOrEqual(844 - BAR);
    expect(control.element().contains(middle)).toBe(true);
  }
});

test("the learned corrections are read in the inspector's strings, not over the canvas", async () => {
  const { zones, names } = await opened("de", 390, 844);

  await tap(page.getByRole("button", { name: names.sheet }));
  await tap(zones.sheet.getByRole("button", { name: /^Strings/u }));

  const check = zones.sheet.getByRole("list", { name: "Modell gegen Messung" });

  await expect.element(check).toMatchTextContent(/Deye · MPPT 1: Korrektur 1,00/u);
  await expect.element(check).toMatchTextContent(/Deye · MPPT 2: Korrektur 1,00/u);
});

test("each string's chip carries the colour its modules glow in", async () => {
  const { zones } = await opened("de", 390, 844);

  const swatches = zones.status
    .getByRole("list", { name: "Leistung je String" })
    .element()
    .querySelectorAll("[data-swatch]");

  const dots = Array.from(swatches, (dot) => getComputedStyle(dot).backgroundColor);

  // Blue, amber, green: the scene's first three string colours.
  expect(dots).toEqual(["rgb(31, 95, 191)", "rgb(224, 138, 0)", "rgb(42, 157, 92)"]);
  expect(unfaded()).toEqual([]);
});
