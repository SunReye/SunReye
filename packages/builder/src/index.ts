// The 3D house builder (ADRs 20, 25): its frame, the scene canvas a consumer shows its scene in, and
// what they read and answer. Each canvas is a studio of its own, so one scene may be shown twice.
// It loads three.js; `./canvas`, `./motion`, `./settings` and `./controls` do not. The package's
// README lists every entry; nothing else of it is public.

export { default as Builder } from "./builder/Builder.svelte";

export { BUILDER_SIZE } from "./builder/size.ts";

export { default as SceneCanvas } from "./builder/SceneCanvas.svelte";

export { headingOf, parseView, presetView, type Preset, type View } from "./builder/camera.ts";

export type { Around, Editing, Hit, Panel, Projector, Roofwork } from "./builder/drawing.svelte.ts";

export type { Aerial } from "./builder/supplied.ts";

export { emptyDraft, panels, type Draft } from "./builder/modules.ts";

export type { Limits } from "./builder/checks.ts";

export { sunAt } from "./builder/pv.ts";

export { speak, type Locale } from "./locale.svelte.ts";

export type {
  Corrections,
  Device,
  Host,
  Interval,
  Keeper,
  LayoutChange,
  Problem,
  Records,
  Span,
} from "./builder/host.ts";

export type { ModelLoader } from "./cars/garage.ts";
