/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { motion } from "../../../../../packages/builder/src/motion/tier.svelte.ts";
import Backdrop from "./Backdrop.svelte";
import {
  addressBar,
  boxes,
  drifts,
  handBeat,
  lights,
  noon,
  plantStream,
  RESTING,
  root,
  teardown,
  TINTS,
} from "./backdrop.harness.ts";
import "../../app.css";

afterEach(teardown);

test("the backdrop takes the core's tint", async () => {
  const dusk = { sunTint: () => Promise.resolve({ tint: "dusk" as const }) };

  await render(Backdrop, { core: dusk });

  await expect.poll(() => root.dataset["tod"]).toBe("dusk");
});

test("a viewer, refused the location, still gets the tint", async () => {
  const viewer = {
    location: () => Promise.resolve({ problem: "auth.forbidden" }),
    sunTint: () => Promise.resolve({ tint: "dawn" as const }),
  };

  await render(Backdrop, { core: viewer });

  await expect.poll(() => root.dataset["tod"]).toBe("dawn");
});

test("without a location the backdrop stays indigo", async () => {
  let asked = false;

  const nowhere = {
    sunTint: () => {
      asked = true;

      return Promise.resolve({ tint: null });
    },
  };

  const screen = await render(Backdrop, { core: nowhere });

  await expect.poll(() => asked).toBe(true);
  expect(root.dataset["tod"]).toBeUndefined();
  // kbase's indigo: hue 277.
  expect(
    getComputedStyle(screen.container.querySelector("[data-light=sun] > *")!).backgroundImage,
  ).toMatch(/oklch\(0\.6 0\.2 277/u);
});

test("each tint has its own spotlight", () => {
  const seen = new Set<string>();

  for (const tint of TINTS) {
    root.dataset["tod"] = tint;
    seen.add(getComputedStyle(root).getPropertyValue("--spotlight"));
  }

  expect(seen.size).toBe(4);
});

test("the lights drift on the full tier and stand still under low power", async () => {
  const hand = handBeat();
  const screen = await render(Backdrop, { core: noon, beat: hand.beat });

  expect(lights(screen.container).map((light) => light.dataset["light"])).toEqual([
    "sun",
    "pv",
    "battery",
    "grid",
  ]);
  expect(drifts(screen.container)).toEqual([RESTING, RESTING, RESTING, RESTING]);

  hand.at(20);

  await expect.poll(() => new Set(drifts(screen.container)).size).toBe(4);
  expect(drifts(screen.container)).not.toContain(RESTING);
  expect(
    lights(screen.container).flatMap((light) => light.getAnimations({ subtree: true })),
  ).toEqual([]);

  motion.lowPower = true;

  await expect.poll(() => drifts(screen.container)).toEqual([RESTING, RESTING, RESTING, RESTING]);
  expect(hand.listening).toBe(false);
});

test("the lights hold still while a phone's address bar hides and shows", async () => {
  await page.viewport(390, 844);

  const hand = handBeat();
  const screen = await render(Backdrop, { core: noon, beat: hand.beat });
  const bar = addressBar(screen.container);

  // The bar shown: 84 px of the screen are the browser's.
  bar(760);

  const shown = boxes(screen.container);

  expect(new Set(shown.map(String)).size).toBe(4);

  bar(844);
  expect(boxes(screen.container)).toEqual(shown);

  bar(734);
  expect(boxes(screen.container)).toEqual(shown);
  // The beat never stepped: the drift moved nothing here.
  expect(drifts(screen.container)).toEqual([RESTING, RESTING, RESTING, RESTING]);
});

test("the PV light follows production and is out while PV is idle", async () => {
  const produce = plantStream();
  const screen = await render(Backdrop, { core: noon });
  const pv = screen.container.querySelector<HTMLElement>("[data-light=pv]")!;
  // The target, not the eased value on the way there.
  const glow = (): number => Number(pv.style.opacity);

  expect(glow()).toBe(0);

  produce(800);
  await expect.poll(glow).toBeGreaterThan(0);

  const low = glow();

  produce(8000);
  await expect.poll(glow).toBeGreaterThan(low);
  expect(glow()).toBeLessThanOrEqual(1);

  produce(20);
  await expect.poll(glow).toBe(0);
});

const hue = (colour: string): number => Number(/oklch\([\d.]+ [\d.]+ ([\d.]+)/u.exec(colour)?.[1]);

test("the PV, battery and grid lights take their energy colour's hue", async () => {
  const screen = await render(Backdrop, { core: noon });

  for (const dark of [false, true]) {
    root.classList.toggle("dark", dark);

    for (const [light, flow] of [
      ["pv", "solar"],
      ["battery", "battery"],
      ["grid", "export"],
    ] as const) {
      const painted = getComputedStyle(
        screen.container.querySelector(`[data-light=${light}] > *`)!,
      ).backgroundImage;

      expect(hue(painted), `${light}, dark ${dark}`).toBe(
        hue(getComputedStyle(root).getPropertyValue(`--e-${flow}`)),
      );
    }
  }
});
