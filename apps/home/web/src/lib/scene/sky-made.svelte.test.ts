import { afterEach, expect, test, vi } from "vitest";
import { Color, PMREMGenerator } from "three";
import { daylight, theme } from "../../../../../../packages/builder/src/scene/light.ts";
import { measured, unmeasure } from "./probe.harness.ts";

// The sky that lights the scene is made again only once the sun has moved far enough to show
// (ADR 20 Rendering): each making filters a cube map, where a minute moves the sun a quarter
// of a degree.

afterEach(() => {
  vi.restoreAllMocks();
  unmeasure();
});

const PAGE = new Color(0.95, 0.95, 0.96);

/** Toward a sun `elevation` degrees up, `azimuth` degrees from north. */
function sun(elevation: number, azimuth: number): [number, number, number] {
  const [up, round] = [(elevation * Math.PI) / 180, (azimuth * Math.PI) / 180];

  return [Math.cos(up) * Math.sin(round), Math.cos(up) * Math.cos(round), Math.sin(up)];
}

/** A studio through half an hour of minutes from a sun `elevation` up: how often the sky was
 * made, and whether its strength followed the light at every one. */
async function halfHour(elevation: number) {
  const { studio } = measured("medium");

  await studio.environ();

  const made = vi.spyOn(PMREMGenerator.prototype, "fromScene");
  let followed = true;

  for (let minute = 0; minute < 30; minute++) {
    const day = daylight(sun(elevation + minute * 0.1, 180 + minute * 0.25));

    studio.light(day, theme(false), PAGE);
    followed &&= studio.scene.environmentIntensity === day.environment * theme(false).environment;
  }

  return { made: made.mock.calls.length, followed };
}

test("half an hour under a high sun makes the sky anew three times at most", async () => {
  expect((await halfHour(40)).made).toBeLessThanOrEqual(3);
});

test("near the horizon, where the sky turns quickly, it is made with every degree", async () => {
  const { made, followed } = await halfHour(4);

  expect(made).toBeGreaterThanOrEqual(7);
  // Its strength is the light's own at every minute, made anew or not.
  expect(followed).toBe(true);
});

test("the sky's strength follows the light under a high sun too, between two makings", async () => {
  expect((await halfHour(40)).followed).toBe(true);
});
