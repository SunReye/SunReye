// The 3D house builder's scene canvas (ADRs 20, 25): the one studio a consumer shows its scene in,
// and what it reads and answers. Each canvas is a studio of its own, so one scene may be shown
// twice. It loads three.js, as `./frame` does; the other entries do not. The package's README
// lists every entry; nothing else of it is public.

export { default as SceneCanvas } from "./builder/SceneCanvas.svelte";

export { headingOf, parseView, presetView, type Preset, type View } from "./builder/camera.ts";

export type { Around, Editing, Hit, Panel, Projector, Roofwork } from "./builder/drawing.svelte.ts";

export { layingOf, type Laying, type LaySteps } from "./builder/gestures.ts";

export type { LineRef, TraceEdit, Tracing } from "./builder/tracing.svelte.ts";

export type { Aerial } from "./builder/supplied.ts";

export { panels } from "./builder/modules.ts";

export { sunAt } from "./builder/pv.ts";

export { speak, type Locale } from "./locale.svelte.ts";
