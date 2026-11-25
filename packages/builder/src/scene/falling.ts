// Rain and snow in the air (ADR 23 "Scene weather"). Rain streaks and snow drifts; both slant
// with the wind. The field is seeded once and
// moved in the vertex shader by the seconds it is handed, so a frame costs no upload and a frame
// drawn again is the same picture.
import {
  BufferAttribute,
  type BufferGeometry,
  type Camera,
  type DepthTexture,
  Group,
  LineSegments,
  type Object3D,
  Points,
  Scene,
  ShaderMaterial,
  Uniform,
  Vector2,
  Vector3,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { toThree } from "../builder/scene.ts";
import { field } from "./falling-field.ts";
import { RAIN, RAIN_BOKEH, SNOW } from "./falling-shaders.ts";
import type { FocusFrame } from "./focus-shader.ts";
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
const COUNT = { rain: 16_000, snow: 20_000 } as const;

/** The lite tier's sparse field, as a share of what falls. */
const SPARSE = 0.25;

/** Seconds of its fall a streak is long: a camera's exposure. */
const EXPOSURE = 0.06;

/** What falls as it lands on screen, by theme: linear, and how opaque. Rain is dark on the light
 * page, where white would not show, and pale on the dark one, never glowing. A flake is white
 * above and its `rim` shade below, which sets it off the white page. On the light page both are
 * drawn over the backdrop in the tone curve's shoulder, which takes contrast: light rain is
 * stronger than whole, as a streak's own coverage keeps its alpha under one. */
const SHADE = {
  rain: {
    light: { colour: [0.035, 0.05, 0.085], rim: [0, 0, 0], opacity: 1.6 },
    dark: { colour: [0.3, 0.34, 0.4], rim: [0, 0, 0], opacity: 0.11 },
  },
  snow: {
    light: { colour: [0.9, 0.92, 0.95], rim: [0.3, 0.37, 0.52], opacity: 1 },
    dark: { colour: [0.9, 0.92, 0.95], rim: [0.45, 0.5, 0.6], opacity: 0.9 },
  },
} as const;

/** The box rain and snow fall in, and where they have fallen to: one for both. */
interface Shared {
  readonly uBox: { readonly value: Vector3 };
  readonly uOrigin: { readonly value: Vector3 };
  readonly uOffset: { readonly value: Vector3 };
  readonly uStreak: { readonly value: Vector3 };
  readonly uPixels: { value: number };
  readonly tSceneDepth: Uniform<DepthTexture | null>;
  readonly uDepthSize: { readonly value: Vector2 };
  readonly tiltShift: Uniform<boolean>;
  readonly depthOfField: Uniform<boolean>;
  readonly focusDepth: Uniform<number>;
  readonly focusY: Uniform<number>;
  readonly plotRadius: Uniform<number>;
  readonly blurPixels: Uniform<number>;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- shared with the shaders.
function material(shaders: typeof RAIN, shared: Shared): ShaderMaterial {
  return new ShaderMaterial({
    ...shaders,
    uniforms: {
      ...shared,
      uColour: { value: new Vector3() },
      uRim: { value: new Vector3() },
      uOpacity: { value: 1 },
    },
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
    tSceneDepth: new Uniform<DepthTexture | null>(null),
    uDepthSize: { value: new Vector2() },
    tiltShift: new Uniform(false),
    depthOfField: new Uniform(false),
    focusDepth: new Uniform(1),
    focusY: new Uniform(0.5),
    plotRadius: new Uniform(10),
    blurPixels: new Uniform(0),
  };

  readonly #rain: LineSegments<BufferGeometry, ShaderMaterial>;
  readonly #bokehRain: Points<BufferGeometry, ShaderMaterial>;
  readonly #snow: Points<BufferGeometry, ShaderMaterial>;
  /** What the scene draws: nothing of it while dry. */
  readonly object = new Group();
  readonly #overlay = new Scene();
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
    this.#bokehRain = unstruck(
      new Points(field(COUNT.rain, 1, 812), material(RAIN_BOKEH, this.#shared)),
    );
    this.#bokehRain.material.depthTest = false;
    this.#snow = unstruck(new Points(field(COUNT.snow, 1, 2023), material(SNOW, this.#shared)));
    this.object.name = "falling";
    this.object.add(this.#rain, this.#bokehRain, this.#snow);
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

    this.#showRain(falling?.kind === "rain");
    this.#snow.visible = falling?.kind === "snow";
    this.#rain.geometry.setDrawRange(0, Math.round(COUNT.rain * share) * 2);
    this.#bokehRain.geometry.setDrawRange(0, Math.round(COUNT.rain * share));
    this.#snow.geometry.setDrawRange(0, Math.round(COUNT.snow * share));

    if (falling === null) return;

    this.#velocity = velocityOf(falling);
    this.#shared.uStreak.value.set(...this.#velocity).multiplyScalar(EXPOSURE);
    this.drift(this.#seconds);
  }

  /** Focus effects see the plant's colour and depth separately from what falls. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js reparents the group.
  afterFocus(enabled: boolean, scene: Scene): void {
    const parent = enabled ? this.#overlay : scene;

    if (this.object.parent === parent) return;

    parent.add(this.object);
    this.#showRain(this.#rain.visible || this.#bokehRain.visible);
    this.#snow.material.depthTest = !enabled;
    this.#shared.tSceneDepth.value = null;
    this.#shared.uDepthSize.value.set(0, 0);
    this.#shared.tiltShift.value = false;
    this.#shared.depthOfField.value = false;
    this.#shared.blurPixels.value = 0;
  }

  #showRain(raining: boolean): void {
    const focused = this.object.parent === this.#overlay;

    this.#rain.visible = raining && !focused;
    this.#bokehRain.visible = raining && focused;
  }

  /** Focuses each particle at its own depth and tests it against the opaque scene. */
  /* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js renders with them. */
  drawOver(
    renderer: WebGLRenderer,
    camera: Camera,
    source: WebGLRenderTarget,
    frame: FocusFrame,
  ): void {
    if (!this.#bokehRain.visible && !this.#snow.visible) return;

    this.#shared.tSceneDepth.value = source.depthTexture;
    this.#shared.uDepthSize.value.set(source.width, source.height);
    this.#shared.tiltShift.value = frame.tiltShift;
    this.#shared.depthOfField.value = frame.depthOfField;
    this.#shared.focusDepth.value = frame.focusDepth;
    this.#shared.focusY.value = frame.focusY;
    this.#shared.plotRadius.value = frame.plotRadius;
    this.#shared.blurPixels.value = frame.blurPixels;
    const clear = renderer.autoClear;

    renderer.autoClear = false;

    try {
      renderer.render(this.#overlay, camera);
    } finally {
      renderer.autoClear = clear;
    }
  }
  /* oxlint-enable typescript/prefer-readonly-parameter-types */

  /** Its shades for the theme, as they land on screen after `exposure` and the tone mapping. */
  tint(dark: boolean, exposure: number): void {
    for (const [part, shades] of [
      [this.#rain, SHADE.rain],
      [this.#bokehRain, SHADE.rain],
      [this.#snow, SHADE.snow],
    ] as const) {
      const { colour, rim, opacity } = dark ? shades.dark : shades.light;
      const { uColour, uRim, uOpacity } = part.material.uniforms;

      if (uColour?.value instanceof Vector3) uColour.value.set(...untone(colour, exposure));

      if (uRim?.value instanceof Vector3) uRim.value.set(...untone(rim, exposure));

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
    for (const part of [this.#rain, this.#bokehRain, this.#snow]) {
      part.geometry.dispose();
      part.material.dispose();
    }
  }
}
