import { flushSync } from "svelte";
import { afterEach, expect, test } from "vitest";
import { weatherEffects } from "./weather-effects.svelte.ts";
import { DROPS, open, playedUntil, RAIN, shut } from "./stage.harness.svelte.ts";
import { DRY } from "./weather.ts";

// The Wettereffekte switch on a lit studio (ADR 23 "Off switch").

afterEach(shut);

test("the Wettereffekte switch, off, leaves the weather's light alone, at once; on, the weather is back", async () => {
  const { looping, fell, lighted, weather, lens, under } = await open();
  const storm = { fog: 0.6, wet: 1, snow: true, covered: true, thunder: true };

  under(storm);
  weather(RAIN);
  lens(DROPS);
  expect(await looping()).toBe(true);
  expect(lighted.mock.lastCall?.[3]).toMatchObject(storm);

  const [day] = lighted.mock.lastCall ?? [];

  weatherEffects.on = false;
  flushSync();
  expect(fell.mock.lastCall).toEqual([null, false]);
  expect(lighted.mock.lastCall?.[3]).toEqual({ ...DRY, thunder: true });
  // Thunder darkens the day as before.
  expect(lighted.mock.lastCall?.[0]).toEqual(day);
  // What was on the lens fades out, and the loop stops.
  await playedUntil(async () => !(await looping()));

  weatherEffects.on = true;
  flushSync();
  expect(fell.mock.lastCall).toEqual([RAIN, false]);
  expect(lighted.mock.lastCall?.[3]).toMatchObject(storm);
  expect(await looping()).toBe(true);
});
