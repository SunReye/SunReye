// The builder's trial weathers (ADR 23 "Builder"): whole instants to see the plant in, each
// stated as the core would read it so the scene draws it as it would the real one.
import type { Weather } from "../scene/scene-weather.ts";

export const TRIALS = ["clear", "cloudy", "rain", "thunder", "snow", "fog"] as const;

export type Trial = (typeof TRIALS)[number];

const CALM: Weather = {
  cloud: 0,
  code: 0,
  precipitation: 0,
  snowfall: 0,
  snowDepth: 0,
  visibility: 30_000,
  wind: 1,
  windDirection: 240,
  celsius: 15,
  humidity: 60,
  ghi: null,
  clearSkyIndex: null,
  dry: null,
};

/** Each trial as an instant's weather; the light follows its `cloud`. */
export const TRIAL_WEATHER: Readonly<Record<Trial, Weather>> = {
  clear: CALM,
  cloudy: { ...CALM, cloud: 0.9, code: 3 },
  rain: {
    ...CALM,
    cloud: 0.95,
    code: 63,
    precipitation: 4,
    wind: 4,
    humidity: 90,
    dry: 0,
  },
  thunder: {
    ...CALM,
    cloud: 1,
    code: 95,
    precipitation: 10,
    wind: 8,
    celsius: 18,
    dry: 0,
  },
  snow: {
    ...CALM,
    cloud: 1,
    code: 73,
    precipitation: 1.5,
    snowfall: 1.5,
    snowDepth: 0.1,
    wind: 2,
    windDirection: 60,
    celsius: -2,
    humidity: 90,
    dry: 0,
  },
  fog: {
    ...CALM,
    cloud: 1,
    code: 45,
    visibility: 150,
    celsius: 3,
    humidity: 98,
  },
};
