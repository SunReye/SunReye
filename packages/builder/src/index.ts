// The 3D house builder's scene canvas (ADRs 20, 25): the one studio a consumer shows its scene in,
// and what it reads and answers. Each canvas is a studio of its own, so one scene may be shown
// twice. It loads three.js, as `./frame` does; the other entries do not. The package's README
// lists every entry; nothing else of it is public.

export { default as SceneCanvas } from "./builder/SceneCanvas.svelte";

export { headingOf, parseView, presetView, type Preset, type View } from "./builder/camera.ts";

export type {
  Around,
  Editing,
  Hit,
  Navigation,
  OnContext,
  OnPress,
  Panel,
  Projector,
  Roofwork,
} from "./builder/drawing.svelte.ts";

export { layingOf, type Laying, type LaySteps } from "./builder/gestures.ts";

export type { LineRef, Placing, Tracing } from "./builder/tracing.svelte.ts";

/** An edit the tracing made, named with its operation's arguments, as the consumer may replay it
 * where it keeps the scene (`@sunreye/scene`'s `replay`). */
export type { TraceEdit } from "@sunreye/scene";

export type { Aerial } from "./builder/supplied.ts";

export { panels } from "./builder/modules.ts";

export { stringCss } from "./builder/panels.ts";

export { sunAt } from "./builder/pv.ts";

export { speak, type Locale } from "./locale.svelte.ts";
