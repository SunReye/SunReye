/**
 * The process's one EVCC ingest, reached by the one consumer still built from
 * an import (`../automation/automation.ts`'s IO). `../plant/plant-wiring.ts`
 * builds the ingest once the bus exists and installs it here; before that every
 * call answers exactly as an ingest that is switched off.
 */

import type { EvccAction, EvccIngest } from "./evcc";

let installed: EvccIngest | null = null;

/** Install the ingest the composition root built. */
export function installEvccIngest(ingest: EvccIngest): void {
  installed = ingest;
}

// fallow-ignore-next-line unused-export -- consumed through `../automation/automation.ts`'s dynamic import, which is not traced
export function evccSnapshot(): ReturnType<EvccIngest["snapshot"]> {
  return installed?.snapshot() ?? null;
}

// fallow-ignore-next-line unused-export -- consumed through `../automation/automation.ts`'s dynamic import, which is not traced
export function evccControl(loadpoint: number, action: EvccAction, value: string): void {
  if (!installed) throw new Error("EVCC MQTT is not connected");
  installed.control(loadpoint, action, value);
}
