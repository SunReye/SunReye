import { afterEach, expect, test, vi } from "vitest";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import { asOverlay } from "../../../../../../packages/builder/src/scene/overlays.ts";
import type { Studio } from "../../../../../../packages/builder/src/scene/studio.ts";
import { mean, picture, post, SIDE } from "./studio-pixels.harness.ts";

let studio: Studio | undefined;

afterEach(() => {
  studio?.dispose();
  studio = undefined;
  vi.restoreAllMocks();
});

/** A seeded stand-in for `Math.random`: the occlusion pass's noise, drawn with it, alike each run. */
function seeded(): () => number {
  let state = 1;

  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;

    return state / 4_294_967_296;
  };
}

/** A handle's unseen reach: drawn into nothing, only hit by the pointer, as the handles' are. */
function reach(): Group {
  const body = new Mesh(
    new BoxGeometry(2, 1, 2),
    new MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false }),
  );

  // Resting on the floor, beside the post, where the occlusion would darken the ground under it.
  body.position.set(-10, 0.5, 6);

  return asOverlay(new Group().add(body));
}

/** The ground's mean in a ring around `[x, y]` on the picture, just outside the reach seen from
 * above, in levels of 255: where the occlusion would darken it. */
function around(pixels: readonly number[], [x, y]: readonly [number, number]): number {
  const found: number[] = [];

  for (let row = y - 30; row <= y + 30; row += 1) {
    for (let column = x - 30; column <= x + 30; column += 1) {
      const from = Math.hypot(row - y, column - x);

      if (from > 18 && from < 30) found.push(pixels[row * SIDE + column] ?? 0);
    }
  }

  return mean(found);
}

test("a handle's unseen reach casts no ambient occlusion on what it stands over", () => {
  vi.spyOn(Math, "random").mockImplementation(seeded());
  studio = post("high");

  // The picture spans 2 × 30 m × tan 20° about x = -6, x growing to the right: -10 m lies left.
  // Rows grow north: the canvas is read from the bottom up, and the camera looks down north up.
  const metre = SIDE / (60 * Math.tan(Math.PI / 9));
  const at = [Math.round(SIDE / 2 - 4 * metre), Math.round(SIDE / 2 - 6 * metre)] as const;
  const bare = around(picture(studio), at);

  studio.scene.add(reach());
  studio.render();

  expect(around(picture(studio), at)).toBeGreaterThanOrEqual(bare - 1);
});

/** A flat handle in one flat colour, as the handles are, lying on the floor at `[x, z]`. */
function plate(x: number, z: number): Group {
  const flat = new Mesh(
    new BoxGeometry(0.8, 0.05, 0.8),
    new MeshBasicMaterial({ color: 0xaaaaaa, toneMapped: false }),
  );

  flat.position.set(x, 0.05, z);

  return asOverlay(new Group().add(flat));
}

test("a handle takes no ambient occlusion from the wall it stands against", () => {
  vi.spyOn(Math, "random").mockImplementation(seeded());
  studio = post("high");

  const metre = SIDE / (60 * Math.tan(Math.PI / 9));

  // Pixel of `[x, z]` on the picture, read bottom up with north up.
  const pixel = ([x, z]: readonly [number, number]) =>
    Math.round(SIDE / 2 - z * metre) * SIDE + Math.round(SIDE / 2 + (x + 6) * metre);

  // One at the post's foot, north of it, where the camera sees past its top; one on open ground.
  const [corner, open] = [
    [0, -1.05],
    [-14, -7],
  ] as const;

  studio.scene.add(plate(...corner), plate(...open));
  studio.render();

  const pixels = picture(studio);

  expect(Math.abs((pixels[pixel(corner)] ?? 0) - (pixels[pixel(open)] ?? 0))).toBeLessThanOrEqual(
    1,
  );
});
