// The scene's settings a consumer's settings screen offers (ADR 21): 3D quality, the frame limit,
// the focus and the weather effects. Loads no three.js.

export { quality } from "../scene/quality.svelte.ts";

export { QUALITIES, type Quality } from "../scene/quality.ts";

export { frameLimit } from "../scene/frame-limit.svelte.ts";

export { FRAME_LIMITS, type FrameLimit } from "../scene/frame-limit.ts";

export { focusEffects } from "../scene/focus-effects.svelte.ts";

export { weatherEffects } from "../scene/weather-effects.svelte.ts";
