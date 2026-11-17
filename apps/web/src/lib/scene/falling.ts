// Rain and snow in the air (ADR 23 "Scene weather"): particles in the scene's own render, without
// a pass. Rain streaks and snow drifts; both slant with the wind. The field is seeded once and
// moved in the vertex shader by the seconds it is handed, so a frame costs no upload and a frame
// drawn again is the same picture.
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineSegments,
  type Object3D,
  Points,
  ShaderMaterial,
  Vector3,
} from "three";
import { toThree } from "../builder/scene.ts";
import { RAIN, SNOW } from "./falling-shaders.ts";
import { untone } from "./tone.ts";
import type { Falling } from "./weather.ts";

/** Metres a second down, and how much of the wind's speed carries it. */
const FALLS = { rain: { down: 9, carried: 1 }, snow: { down: 1.3, carried: 0.6 } } as const;

/** The most it slants: this many metres aside per metre down. */
const SLANT = 4;

/** How fast what falls moves, in three.js's frame: down, and aside with the wind. */
export function velocityOf({ kind, wind: [east, north] }: Falling): [number, number, number] {
  const { down, carried } = FALLS[kind];
  const speed = Math.hypot(east, north) * carried;
  const scale = speed === 0 ? 0 : (Math.min(speed, down * SLANT) / speed) * carried;

  return toThree([east * scale, north * scale, -down]);
}

/** The whole field: this many streaks and flakes in the box. */
const COUNT = { rain: 9000, snow: 12_000 } as const;

/** The lite tier's sparse field, as a share of what falls. */
const SPARSE = 0.25;

/** Seconds of its fall a streak is long: a camera's exposure. */
const EXPOSURE = 0.06;

/** What falls as it lands on screen, by theme: linear, and how opaque. Grey on the light page,
 * where white would not show; pale on the dark one, and never glowing. */
const SHADE = {
  rain: {
    light: { colour: [0.1, 0.12, 0.16], opacity: 0.6 },
    dark: { colour: [0.3, 0.34, 0.4], opacity: 0.5 },
  },
  snow: {
    light: { colour: [0.48, 0.54, 0.64], opacity: 0.9 },
    dark: { colour: [0.42, 0.45, 0.5], opacity: 0.85 },
  },
} as const;

/** A seeded generator: the same field in every browser and on every draw. */
function seeded(seed: number): () => number {
  let state = seed;

  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;

    // The low bits of such a state repeat early: mixed down from the high ones.
    const mixed = Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) >>> 0;

    return ((mixed ^ (mixed >>> 12)) >>> 0) / 4_294_967_296;
  };
}

/** `count` places in the unit box, each `copies` times over, and a seed for each place. */
function field(count: number, copies: number, seed: number): BufferGeometry {
  const random = seeded(seed);
  const places = new Float32Array(count * copies * 3);
  const seeds = new Float32Array(count * copies);

  for (let i = 0; i < count; i++) {
    const place = [random(), random(), random()];
    const own = random();

    for (let copy = 0; copy < copies; copy++) {
      places.set(place, (i * copies + copy) * 3);
      seeds[i * copies + copy] = own;
    }
  }

  const geometry = new BufferGeometry();

  geometry.setAttribute("position", new BufferAttribute(places, 3));
  geometry.setAttribute("seed", new BufferAttribute(seeds, 1));

  return geometry;
}

/** The box rain and snow fall in, and where they have fallen to: one for both. */
interface Shared {
  readonly uBox: { readonly value: Vector3 };
  readonly uOrigin: { readonly value: Vector3 };
  readonly uOffset: { readonly value: Vector3 };
  readonly uStreak: { readonly value: Vector3 };
  readonly uPixels: { value: number };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- shared with the shaders.
function material(shaders: typeof RAIN, shared: Shared): ShaderMaterial {
  return new ShaderMaterial({
    ...shaders,
    uniforms: { ...shared, uColour: { value: new Vector3() }, uOpacity: { value: 1 } },
    transparent: true,
    depthWrite: false,
  });
}

/** Never struck by a ray, and never culled: the shader places it. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own object.
function unstruck<T extends Object3D>(part: T): T {
  part.raycast = () => {};

  part.frustumCulled = false;
  part.visible = false;

  return part;
}

export class Fall {
  readonly #shared: Shared = {
    uBox: { value: new Vector3(1, 1, 1) },
    uOrigin: { value: new Vector3() },
    uOffset: { value: new Vector3() },
    uStreak: { value: new Vector3() },
    uPixels: { value: 1 },
  };

  readonly #rain: LineSegments<BufferGeometry, ShaderMaterial>;
  readonly #snow: Points<BufferGeometry, ShaderMaterial>;
  /** What the scene draws: nothing of it while dry. */
  readonly object = new Group();
  #velocity: readonly [number, number, number] = [0, 0, 0];
  #seconds = 0;

  constructor() {
    const streaks = field(COUNT.rain, 2, 812);

    // Each streak's second end is its tail.
    streaks.setAttribute(
      "tail",
      new BufferAttribute(
        Float32Array.from({ length: COUNT.rain * 2 }, (_, i) => i % 2),
        1,
      ),
    );
    this.#rain = unstruck(new LineSegments(streaks, material(RAIN, this.#shared)));
    this.#snow = unstruck(new Points(field(COUNT.snow, 1, 2023), material(SNOW, this.#shared)));
    this.object.name = "falling";
    this.object.add(this.#rain, this.#snow);
  }

  /** Fits the box to the plot: its centre east and south, and its radius in metres. Wide, so it
   * falls between the camera and the house from wherever the camera stands. */
  fit(east: number, south: number, radius: number): void {
    const side = radius * 8 + 40;
    const height = radius * 2 + 12;

    this.#shared.uBox.value.set(side, height, side);
    this.#shared.uOrigin.value.set(east - side / 2, 0, south - side / 2);
    this.drift(this.#seconds);
  }

  /** What falls, `sparse` for the lite tier's thin field; null while it is dry. */
  show(falling: Falling | null, sparse: boolean): void {
    const share = (falling?.density ?? 0) * (sparse ? SPARSE : 1);

    this.#rain.visible = falling?.kind === "rain";
    this.#snow.visible = falling?.kind === "snow";
    this.#rain.geometry.setDrawRange(0, Math.round(COUNT.rain * share) * 2);
    this.#snow.geometry.setDrawRange(0, Math.round(COUNT.snow * share));

    if (falling === null) return;

    this.#velocity = velocityOf(falling);
    this.#shared.uStreak.value.set(...this.#velocity).multiplyScalar(EXPOSURE);
    this.drift(this.#seconds);
  }

  /** Its shades for the theme, as they land on screen after `exposure` and the tone mapping. */
  tint(dark: boolean, exposure: number): void {
    for (const [part, shades] of [
      [this.#rain, SHADE.rain],
      [this.#snow, SHADE.snow],
    ] as const) {
      const { colour, opacity } = dark ? shades.dark : shades.light;
      const { uColour, uOpacity } = part.material.uniforms;

      if (uColour?.value instanceof Vector3) uColour.value.set(...untone(colour, exposure));

      if (uOpacity !== undefined) uOpacity.value = opacity;
    }
  }

  /** The drawing's height in device pixels: a flake keeps its size in metres. */
  size(pixels: number): void {
    this.#shared.uPixels.value = pixels / 2;
  }

  /** Where it has fallen to after `seconds`. */
  drift(seconds: number): void {
    const box = this.#shared.uBox.value.toArray();

    this.#seconds = seconds;
    // Wrapped here, in doubles: the shader's floats would lose the place after an hour of rain.
    this.#shared.uOffset.value.fromArray(
      this.#velocity.map((speed, axis) => {
        const side = box[axis] ?? 1;

        return (((speed * seconds) % side) + side) % side;
      }),
    );
  }

  dispose(): void {
    for (const part of [this.#rain, this.#snow]) {
      part.geometry.dispose();
      part.material.dispose();
    }
  }
}
