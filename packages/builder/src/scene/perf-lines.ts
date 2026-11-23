// The scene's readout as lines of text (ADR 21 "Measuring"). Pure: the overlay only shows them.
import type { Frame, Pass } from "./probe.ts";

/** Whether the URL's `hash` asks for the readout: `perf` in the hash route's query. */
export function asked(hash: string): boolean {
  return new URLSearchParams(hash.split("?")[1] ?? "").has("perf");
}

/** What the readout tells, as sampled. */
export interface Facts {
  /** The last frame drawn. */
  readonly frame: Frame | undefined;
  readonly fps: number;
  /** Milliseconds the GPU took over a frame; null where the browser does not measure it. */
  readonly gpu: number | null;
  readonly pixelRatio: number;
  /** The sun's shadow map, in texels a side, and whether occlusion and contact shadows draw. */
  readonly shadowMap: number;
  readonly occlusion: boolean;
  readonly contact: boolean;
  /** The 3D quality chosen, and the level drawn. */
  readonly quality: string;
  readonly level: string;
  readonly tier: string;
  readonly looping: boolean;
  /** WebGL2's unmasked renderer. */
  readonly renderer: string | null;
  /** What this browser keeps of its strains, as kept. */
  readonly strains: {
    readonly drawing: string | null;
    readonly motion: string | null;
    readonly at: string | null;
  };
}

const ms = (value: number | null | undefined): string =>
  value === null || value === undefined ? "–" : value.toFixed(1);

const onOff = (on: boolean): string => (on ? "on" : "off");

const sized = ({ target, width, height, samples }: Pass): string =>
  `  ${target} ${width}×${height}${samples > 0 ? ` ×${samples}` : ""}`;

/** The frame's own lines: its draws, and each pass with the size of what it drew into. */
function drawn({ frame, pixelRatio }: Facts): string[] {
  if (frame === undefined) return ["no frame drawn yet"];

  const canvas = frame.passes.find(({ target }) => target === "canvas");

  return [
    `${frame.calls} draws · ${frame.triangles} tris · ${frame.programs} programs · ${frame.shadows} shadow map`,
    `DPR ${pixelRatio} · canvas ${canvas?.width ?? 0}×${canvas?.height ?? 0} · ${frame.passes.length} passes`,
    ...frame.passes.map((pass) => sized(pass)),
  ];
}

export function readout(facts: Facts): string[] {
  const { frame, fps, gpu, quality, level, tier, looping, renderer, strains } = facts;
  const { shadowMap, occlusion, contact } = facts;

  return [
    `${fps} fps · JS ${ms(frame?.script)} ms · GPU ${ms(gpu)} ms`,
    ...drawn(facts),
    `shadow map ${shadowMap} · AO ${onOff(occlusion)} · contact shadows ${onOff(contact)}`,
    `quality ${quality} → ${level} · tier ${tier} · loop ${onOff(looping)}`,
    renderer ?? "GPU unnamed",
    `3d-strain ${strains.drawing ?? "–"} · motion-strain ${strains.motion ?? "–"} · strained-at ${strains.at ?? "–"}`,
  ];
}
