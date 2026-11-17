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
import { toThree } from "../builder/panels.ts";
import { type Triple, untone } from "./tone.ts";
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

/** A flake's width in metres: far over a real one's, which no screen would show. */
const FLAKE = 0.11;

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

/** Positions in the box wrap round it: what leaves below comes in above. */
const PLACED = /* glsl */ `
  uniform vec3 uBox;
  uniform vec3 uOrigin;
  uniform vec3 uOffset;

  vec3 placed(vec3 seeded) {
    return mod(seeded * uBox + uOffset, uBox) + uOrigin;
  }
`;

const RAIN_VERTEX = /* glsl */ `
  ${PLACED}
  uniform vec3 uStreak;
  attribute float tail;
  varying float vAlpha;

  void main() {
    // The tail trails where the drop came from, and fades out.
    vAlpha = 1.0 - tail;
    gl_Position = projectionMatrix * viewMatrix * vec4(placed(position) - tail * uStreak, 1.0);
  }
`;

const SNOW_VERTEX = /* glsl */ `
  ${PLACED}
  uniform float uPixels;
  attribute float seed;
  varying float vAlpha;

  void main() {
    vec3 at = placed(position);

    // It sways as it sinks: by its height, so it never jumps where the box wraps.
    at.x += sin(at.y * 1.7 + seed * 6.283) * 0.25;
    at.z += cos(at.y * 1.3 + seed * 12.566) * 0.25;

    vec4 seen = viewMatrix * vec4(at, 1.0);

    gl_Position = projectionMatrix * seen;

    float size = ${FLAKE.toFixed(3)} * (0.6 + 0.8 * seed) * projectionMatrix[1][1] * uPixels / -seen.z;

    // Under a pixel and a half it thins instead of shrinking away.
    vAlpha = min(1.0, size / 1.5);
    // And a flake before the camera's nose is no blot.
    gl_PointSize = clamp(size, 1.5, 12.0);
  }
`;

const RAIN_FRAGMENT = /* glsl */ `
  uniform vec3 uColour;
  uniform float uOpacity;
  varying float vAlpha;

  void main() {
    gl_FragColor = vec4(uColour, uOpacity * vAlpha);
  }
`;

const SNOW_FRAGMENT = /* glsl */ `
  uniform vec3 uColour;
  uniform float uOpacity;
  varying float vAlpha;

  void main() {
    float soft = 1.0 - smoothstep(0.2, 0.5, length(gl_PointCoord - 0.5));

    gl_FragColor = vec4(uColour, uOpacity * vAlpha * soft);
  }
`;

/** A seeded generator: the same field in every browser and on every draw. */
function seeded(seed: number): () => number {
  let state = seed;

  return () => {
    state = (state + 0x6d2b79f5) | 0;

    let t = Math.imul(state ^ (state >>> 15), 1 | state);

    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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

function material(vertexShader: string, fragmentShader: string, shared: object): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
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
  /** Rain and snow share the box they fall in. */
  readonly #shared = {
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
  #velocity: Triple = [0, 0, 0];
  #seconds = 0;

  constructor() {
    const streaks = field(COUNT.rain, 2, 812);

    // Each streak's second end is its tail.
    streaks.setAttribute(
      "tail",
      new BufferAttribute(Float32Array.from({ length: COUNT.rain * 2 }, (_, i) => i % 2), 1),
    );
    this.#rain = unstruck(
      new LineSegments(streaks, material(RAIN_VERTEX, RAIN_FRAGMENT, this.#shared)),
    );
    this.#snow = unstruck(
      new Points(field(COUNT.snow, 1, 2023), material(SNOW_VERTEX, SNOW_FRAGMENT, this.#shared)),
    );
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
