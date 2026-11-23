// The 3D house builder's components (ADRs 20, 25): so far the scene canvas, the one studio a
// consumer shows its scene in. Each canvas is a studio of its own, so one scene may be shown twice.

export { default as SceneCanvas } from "./builder/SceneCanvas.svelte";

export type { CanvasWords, PerfWords } from "./builder/words.ts";

export type { View } from "./builder/camera.ts";

export type { Around, Editing, Projector, Roofwork } from "./builder/drawing.svelte.ts";

export type { Hit, Panel } from "./builder/scene.ts";

export type { Plant, SceneWeather } from "./scene/weather.ts";
