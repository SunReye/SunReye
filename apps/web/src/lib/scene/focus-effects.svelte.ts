import { read, write } from "../kept.ts";

const KEYS = { tiltShift: "sunreye.tilt-shift", depthOfField: "sunreye.depth-of-field" } as const;

class FocusEffects {
  #enabled = $state({
    tiltShift: read(KEYS.tiltShift) === "on",
    depthOfField: read(KEYS.depthOfField) === "on",
  });

  get tiltShift(): boolean {
    return this.#enabled.tiltShift;
  }

  get depthOfField(): boolean {
    return this.#enabled.depthOfField;
  }

  set(effect: keyof typeof KEYS, on: boolean): void {
    this.#enabled[effect] = on;
    write(KEYS[effect], on ? "on" : "off");
  }
}

export const focusEffects = new FocusEffects();
