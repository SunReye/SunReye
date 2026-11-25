// What a consumer's screens read of the canvas before it loads, or without it (ADRs 23, 25): the
// engine fetched, the scene's weather from an instant's, the parked cars, the warm-up and the
// stand-in's backdrop.
// Loads no three.js.

export type { Plant, SceneWeather } from "../scene/weather.ts";

export { codeKind, sceneWeather, snowLies, type Weather } from "../scene/scene-weather.ts";

export { fetchPv } from "../builder/engine.ts";

export { parked, type Parked } from "../cars/parked.ts";

export type { SceneFailure } from "../scene/stage.svelte.ts";

export { idle, rememberedWebgl2, rememberWebgl2, warm } from "../scene/warm.ts";
