// The builder's frame (ADRs 20, 25): a canvas, the time slider and the inspector of one editing
// session, and what it asks of and reads from its host. Apart from the canvas, so a screen that only
// shows the scene loads none of it.

export { default as Builder } from "../builder/Builder.svelte";

export { BUILDER_SIZE } from "../builder/size.ts";

export { emptyDraft, type Draft } from "../builder/modules.ts";

export type { Limits } from "../builder/checks.ts";

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
} from "../builder/host.ts";

export type { ModelLoader } from "../cars/garage.ts";
