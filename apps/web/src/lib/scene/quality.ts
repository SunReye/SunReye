// The 3D quality (ADR 20 Look, Rendering quality): how richly a browser draws the scene, as plain
// TS. It governs the drawing only; what moves is the motion tier's (ADR 21). The rune shell that
// keeps the choice per browser is `./quality.svelte.ts`.
import type { MotionTier } from "../motion/tier.ts";

/** What the setting offers. */
export const QUALITIES = ["auto", "low", "medium", "high", "ultra"] as const;

export type Quality = (typeof QUALITIES)[number];

/** A level that is drawn: Niedrig, Mittel, Hoch or Ultra. */
export type Level = Exclude<Quality, "auto">;

const LEVELS: readonly Level[] = ["low", "medium", "high", "ultra"];

/** What a studio draws at a level. Levels differ in sharpness alone. */
export interface Look {
  readonly level: Level;
  /** The most device pixels drawn per CSS pixel. */
  readonly pixelRatio: number;
  /** The sun's shadow map, in texels a side. */
  readonly shadowMap: number;
  /** The ambient-occlusion pass: the full motion tier's, from Mittel up. */
  readonly occlusion: boolean;
  /** The most device pixels the occlusion pass draws per CSS pixel, and its samples a pixel: it
   * is wide and soft, and the largest single cost of a frame. */
  readonly occluded: number;
  readonly samples: number;
  /** The lens glass (ADR 23): the full motion tier's, from Mittel up. */
  readonly glass: boolean;
  /** Hoch's: shadows that harden where they touch their caster. */
  readonly contact: boolean;
  /** Ultra's: the antialiasing burst. */
  readonly finest: boolean;
}

const BARE = { occlusion: false, glass: false } as const;
const FULL = { occlusion: true, glass: true } as const;

/** Mittel's occlusion: at half its pixel ratio, from 8 samples. */
const COARSE = { occluded: 0.75, samples: 8 } as const;

/** Hoch's: at up to Mittel's pixel ratio, from 12. */
const FINE = { occluded: 1.5, samples: 12 } as const;

const MEDIUM: Look = {
  level: "medium",
  pixelRatio: 1.5,
  shadowMap: 2048,
  ...FULL,
  ...COARSE,
  contact: false,
  finest: false,
};

const HIGH: Look = {
  ...MEDIUM,
  level: "high",
  pixelRatio: 2,
  shadowMap: 4096,
  ...FINE,
  contact: true,
};

const LOOKS: Readonly<Record<Level, Look>> = {
  low: { ...MEDIUM, level: "low", pixelRatio: 1, shadowMap: 1024, ...BARE },
  medium: MEDIUM,
  high: HIGH,
  ultra: { ...HIGH, level: "ultra", pixelRatio: Infinity, occluded: Infinity, finest: true },
};

/** What Auto goes by. */
export interface Device {
  /** Whether WebGL2 reports a discrete or capable GPU. */
  readonly capable: boolean;
  /** A touch device, one whose primary pointer is coarse: a phone or a tablet. Its GPU's name
   * does not tell it from a desktop's, and its screen is more than it fills at Hoch (ADR 20). */
  readonly touch?: boolean;
  /** Levels the frame watch has taken off Auto. */
  readonly steps: number;
  readonly tier: MotionTier;
}

/** The most levels strain takes off Auto: Hoch down to Niedrig. */
export const MAX_STEPS = 2;

/** Auto's level before the motion tier caps it: from Hoch on a capable desktop GPU, from Mittel
 * elsewhere. */
function measured({ capable: strong, touch, steps }: Device): number {
  return Math.max(0, (strong && touch !== true ? 2 : 1) - steps);
}

/** Auto's level: the measured one, on the lite and still tiers at most Mittel. */
function auto(device: Device): Level {
  const level = measured(device);

  return LEVELS[device.tier === "full" ? level : Math.min(level, 1)] ?? "medium";
}

/** What is drawn for `choice` on this device. A chosen level keeps its sharpness on any tier;
 * occlusion and the lens glass are the full motion tier's alone (ADR 21, ADR 23). */
export function drawn(choice: Quality, device: Device): Look {
  const look = LOOKS[choice === "auto" ? auto(device) : choice];

  return device.tier === "full" ? look : { ...look, ...BARE };
}

/**
 * Whether a measured strain takes a level off Auto's drawing instead of lowering the motion
 * tier: above Mittel the drawing is the likelier cost, so it goes first; Mittel goes to Niedrig
 * only once the tier is lite and has nothing left to give.
 */
export function relief(choice: Quality, device: Device): boolean {
  if (choice !== "auto") return false;

  const level = measured(device);

  return device.tier === "full" ? level > 1 : level > 0;
}

/** Software rasterisers, and GPU families too slow for Hoch. */
const WEAK = /swiftshader|llvmpipe|software|basic render|mali-[t4]|powervr|videocore|vivante/iu;

/** Discrete cards, Apple's own, and integrated or mobile GPUs of recent years. */
const STRONG = [
  /nvidia|geforce|quadro|rtx|gtx/iu,
  /radeon|\bamd\b/iu,
  /apple (?:gpu|m\d)|apple, /iu,
  /\biris\b|\barc\b/iu,
  /adreno \(tm\) [6-9]\d\d/iu,
  /mali-g(?:7[1-9]|[6-9]1\d|[6-9]2\d|7\d\d)/iu,
] as const;

/** Whether WebGL2's unmasked renderer names a discrete or capable GPU; unknown ones are not. */
export function capable(gpu: string | null): boolean {
  if (gpu === null || WEAK.test(gpu)) return false;

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a pattern, only tested.
  return STRONG.some((family) => family.test(gpu));
}

/** WebGL2's unmasked renderer, where the browser tells. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the browser's own, only asked.
export function gpuOf(gl: WebGLRenderingContext | WebGL2RenderingContext): string | null {
  const told = gl.getExtension("WEBGL_debug_renderer_info");

  return told === null ? null : String(gl.getParameter(told.UNMASKED_RENDERER_WEBGL));
}

export function parseQuality(raw: string | null): Quality {
  return QUALITIES.find((quality) => quality === raw) ?? "auto";
}

/** Steps from storage; anything unreadable is none, so a healthy device is never pinned low. */
export function parseSteps(raw: string | null): number {
  const steps = Math.trunc(Number(raw ?? 0));

  return Number.isNaN(steps) ? 0 : Math.min(MAX_STEPS, Math.max(0, steps));
}
