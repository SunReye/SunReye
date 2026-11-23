// The scene canvas's words in the app's language (ADR 25): the canvas carries none of its own.
import { m } from "../paraglide/messages.js";
import { getLocale } from "../paraglide/runtime.js";
import type { CanvasWords } from "@sunreye/builder/builder/words.ts";

export function canvasWords(): CanvasWords {
  return {
    locale: getLocale(),
    scene: m.builder_scene(),
    perf: {
      readout: m.perf_readout(),
      occlusion: m.perf_occlusion(),
      contact: m.perf_contact(),
      ratio: m.perf_ratio(),
      shadowMap: m.perf_shadow_map(),
    },
  };
}
