// When the hero loads its 3D scene (ADR 20 Loading), ported from the prototype's hero: after the
// dashboard has painted and gone idle, never with 2D chosen, under the low-power switch or without
// WebGL2. No three.js here: this decides when it is asked for.
import { untrack } from "svelte";
import { motion } from "../motion/tier.svelte.ts";
import type { SceneFailure } from "../scene/stage.svelte.ts";
import { idle, rememberedWebgl2, rememberWebgl2, warm } from "../scene/warm.ts";

export class SceneLoad {
  /** Whether this browser draws WebGL2: as the last visit found, until the worker answers. */
  webgl2 = $state(rememberedWebgl2());
  stage = $state<"loading" | "ready" | "failed">("loading");
  /** The studio stand-in on a first visit, the flow it replaces after a switch. */
  under = $state<"standin" | "flow" | "none">("standin");
  /** Loading has taken longer than a second: say so. */
  slow = $state(false);
  /** The scene may mount and start loading three.js. */
  mounted = $state(false);
  /** Bumped by a retry. */
  #attempt = $state(0);

  #first = true;
  #settle: ReturnType<typeof setTimeout> | undefined;

  /**
   * Loads whenever the scene becomes `wanted`, and again on a retry. An effect, as the wish
   * changes from outside too: the low-power switch. Call during a component's set-up.
   */
  follow(wanted: () => boolean): void {
    $effect(() => {
      void this.#attempt;

      return wanted() ? untrack(() => this.#begin()) : this.#leave();
    });
  }

  /** Starts a load; the disposer cancels it. */
  #begin(): () => void {
    this.stage = "loading";
    this.slow = false;
    this.mounted = false;
    this.under = this.#first ? "standin" : "flow";
    this.#first = false;

    let cancelled = false;

    const slow = setTimeout(() => {
      this.slow = true;
    }, 1000);

    // After the dashboard has painted and the main thread has nothing better to do.
    requestAnimationFrame(() => {
      idle(() => void this.#mount(() => cancelled), 1500);
    });

    return () => {
      cancelled = true;
      clearTimeout(slow);
      clearTimeout(this.#settle);
    };
  }

  /** The flow shows instead: the next 3D fades in over it. */
  #leave(): () => void {
    this.#first = false;

    return () => {};
  }

  retry(): void {
    this.#attempt += 1;
  }

  ready(): void {
    this.stage = "ready";
    // What was underneath goes once the fade has covered it.
    this.#settle = setTimeout(
      () => {
        this.under = "none";
      },
      motion.still ? 0 : 400,
    );
  }

  fail(reason: SceneFailure): void {
    if (reason === "webgl2") {
      // Not an error: this browser cannot draw the scene, so the flow is the dashboard.
      rememberWebgl2(false);
      this.webgl2 = false;
    } else this.stage = "failed";
  }

  async #mount(cancelled: () => boolean): Promise<void> {
    if (cancelled()) return;

    // The worker answers before three.js is asked for; when it cannot tell, the renderer will.
    if ((await warm().webgl2) === false) {
      this.webgl2 = false;

      return;
    }

    if (!cancelled()) this.mounted = true;
  }
}
