// What the mouse is over in an editor's navigation (ADR 20 "Navigation"): the roof face it would
// pick is outlined, and the cursor says what a press does.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js and the DOM, used in place. */
import type { Lens } from "./lens.ts";
import { roofFaceKey, type RoofFaceId } from "@sunreye/scene";
import type { Group } from "three";
import { cursorOf } from "./cursor.ts";
import type { Editing } from "./handles/grabbing.ts";
import { ndc } from "./pointer.ts";
import { spaceHeld } from "./space.ts";
import { strike, type Hit, type Panel } from "./scene.ts";

export interface Hovering {
  readonly active: () => boolean;
  readonly drawn: () => Group | undefined;
  readonly panels: () => readonly Panel[];
  readonly editing: () => Editing | undefined;
  /** The roof face a hit is on; null off every roof. */
  readonly faceOf: (hit: Hit | null) => RoofFaceId | null;
}

export class Hover {
  /** The key of the face under the mouse; none off every roof. */
  key = $state<string>();

  /** Follows the mouse over `canvas`, after the handles' listeners; returns the removal. */
  attach(canvas: HTMLCanvasElement, camera: Lens, sources: Hovering): () => void {
    const under = (event: PointerEvent): Hit | null => {
      const group = sources.drawn();

      if (group === undefined || spaceHeld()) return null;

      camera.updateMatrixWorld();

      return strike(group, sources.panels(), camera, ndc(canvas, event));
    };

    const move = (event: PointerEvent): void => {
      // A button down drags or pans, a finger hovers nothing, and the handles show "grab" over
      // themselves.
      const idle = sources.active() && event.pointerType === "mouse" && event.buttons === 0;

      if (!idle || (canvas.style.cursor === "grab" && !spaceHeld())) return;

      const hit = under(event);
      const face = sources.faceOf(hit);

      this.key = face === null ? undefined : roofFaceKey(face);
      canvas.style.cursor = cursorOf({
        hit,
        face,
        editing: sources.editing(),
        panning: spaceHeld(),
      });
    };

    const leave = (): void => {
      this.key = undefined;
    };

    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerleave", leave);

    return () => {
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
    };
  }
}
