// The Wettereffekte switch as reactive state (ADR 23 "Off switch"): off, a scene draws the
// weather's light alone. Kept per browser, and read by every scene at once.
import { read, write } from "../kept.ts";

/** Where each browser keeps its weather effects switch: "on", "off", or unset for on. */
export const WEATHER_EFFECTS = "sunreye.weather-effects";

export class WeatherEffects {
  #on = $state(read(WEATHER_EFFECTS) !== "off");

  get on(): boolean {
    return this.#on;
  }

  /** Kept per browser. */
  set on(next: boolean) {
    this.#on = next;
    write(WEATHER_EFFECTS, next ? "on" : "off");
  }
}

export const weatherEffects = new WeatherEffects();
