// When a studio draws (ADR 20): once per frame on a change and while the camera flies, in a loop
// only while the weather's moves (ADR 23 "Motion"), and nothing before it is prepared, so the
// first frame never waits on a compile. Ported from the prototype's background load.
import { motion } from "../motion/tier.svelte.ts";
import { Burst } from "./burst.ts";
import { Flight } from "./flight.ts";
import { Fade } from "./lens.ts";
import { Loop, pauseUnseen } from "./loop.ts";
import { ahead, gpuIdle, nextFrame, pause, prepare } from "./prepare.ts";
import type { Ghost } from "./stage.svelte.ts";
import type { Studio } from "./studio.ts";
import type { Falling, Glass } from "./weather.ts";
import { idle } from "./warm.ts";

export class Opening {
  readonly #studio: Studio;
  /** The camera's flight to a new view; it lands at once on the still tier. */
  readonly flight = new Flight(() => motion.still);
  readonly #drawn: () => void;
  #frame = 0;
  /** A settled picture's refining burst (ADR 20 Rendering quality). */
  readonly #burst: Burst;
  #held = true;
  #gone = false;
  #later: ReturnType<typeof setTimeout> | undefined;
  /** A change waits for the loop's next frame: the picture is not the last one moved on. */
  #changed = false;
  readonly #unwatch: () => void;
  /** The lens glass as it fades, and its hold on the loop while anything on it moves or fades. */
  readonly #lens = new Fade();
  #glazing: (() => void) | undefined;
  /** The frame watch's leave of its idle watch while the loop runs. */
  #looping: (() => void) | undefined;
  /** Told once the first frame is drawn, or never will be: the frame watch settles from then. */
  readonly #settle: () => void;

  /**
   * The weather loop (ADR 23 "Motion"): the one loop this studio is drawn in. What moves keeps
   * it running with `keep`, and it draws while anything is kept, the picture is prepared, the
   * tier is full, the tab is shown and the canvas is on screen. Every change asked for with
   * `render` is drawn in its frames while it runs.
   */
  readonly loop: Loop = new Loop({
    frames: {
      request: (frame) => requestAnimationFrame(frame),
      cancel: (id) => {
        cancelAnimationFrame(id);
      },
    },
    draw: (now) => this.#paint(now),
    count: (now) => {
      motion.frame(now);
    },
    // The frame watch judges the loop by its own frames while it runs (ADR 21).
    started: () => {
      this.#looping = motion.loop();
    },
    // One frame more: it places the labels and starts the burst the loop's frames went without.
    stopped: () => {
      this.#looping?.();
      this.#changed = false;
      this.render();
    },
  });

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws with it.
  constructor(studio: Studio, drawn: () => void, settle: () => void) {
    this.#studio = studio;
    this.#drawn = drawn;
    this.#settle = settle;
    this.#burst = new Burst(studio, () => this.#held || this.#gone);
    this.loop.pause("held", true);
    this.#unwatch = pauseUnseen(this.loop, studio.renderer.domElement);
  }

  /** Draws in the next frame, unless held. */
  readonly render = (): void => {
    if (this.#held || this.#gone) return;

    // The picture is about to change: what refined the last one is void.
    this.#burst.rest();

    // One frame, one draw: the loop's own is the next, whatever its cap.
    if (this.loop.running) {
      this.#changed = true;
      this.loop.ask();

      return;
    }

    this.#frame ||= requestAnimationFrame((now) => {
      this.#frame = 0;
      this.#changed = true;

      if (this.#paint(now)) this.render();
    });
  };

  /** What casts a shadow changed, as when a car parks: draws in the next frame, the sun's shadow
   * map with it (ADR 20 Rendering). */
  // fallow-ignore-next-line unused-class-member -- SceneCanvas calls it through `Lit["opening"]`.
  readonly recast = (): void => {
    this.#studio.recast();
    this.render();
  };

  /**
   * Shows what moves with the `weather`, read as it changes (ADR 23). What falls is shown as
   * the motion tier does: it moves in the loop on full, lite draws a sparse still field, still
   * draws none. The glass is put on the lens: it fades in and out in the loop, which it keeps
   * until the lens is clear again or frost alone stands on it; off the full tier, where nothing
   * loops, the lens is cleared at once. Call during a component's set-up.
   */
  moves(weather: { readonly falling: Falling | null; readonly glass: Glass | null }): void {
    $effect(() => {
      const target = weather.glass;

      if (motion.tier === "full") this.#glaze(target);
      else this.#clear();
    });

    $effect(() => {
      const fell = weather.falling;
      const { tier } = motion;

      this.#studio.fall(tier === "still" ? null : fell, tier === "lite");
      this.render();

      return fell !== null && tier === "full"
        ? this.loop.keep((seconds) => {
            this.#studio.drift(seconds);
          })
        : undefined;
    });

    // The loop is the full tier's, whoever keeps it.
    $effect(() => {
      this.loop.pause("tier", motion.tier !== "full");
    });
  }

  /** Once `built`, prepares, draws the first frame, calls `ready` once it is drawn, and `due`
   * when idle after. */
  async open(built: Readonly<Promise<void>>, ready: () => void, due: () => void): Promise<void> {
    try {
      await this.#first(built);
    } finally {
      this.#settle();
    }

    if (this.#gone || this.#held) return;

    ready();
    // After the fade, when nothing else is waiting.
    this.#later = setTimeout(() => {
      idle(due, 2000);
    }, 450);
  }

  /** Prepares and draws the first frame; held still if it could not be. */
  async #first(built: Readonly<Promise<void>>): Promise<void> {
    await built;
    await pause();

    if (this.#gone || !(await prepare(this.#studio, this.#isGone))) return;

    this.#held = false;
    this.loop.pause("held", false);
    this.#changed = true;
    this.#draw();
    // Not before the GPU has drawn it: a fade over a frame still rasterising is a cut.
    await gpuIdle(this.#studio.renderer);
    await nextFrame();
  }

  /** Runs `park`, its programs compiled first; on screen, the change fades in. */
  /* oxlint-disable typescript/prefer-readonly-parameter-types -- the canvas is drawn on. */
  // fallow-ignore-next-line unused-class-member -- SceneCanvas calls it through `Lit["opening"]`.
  async arrive(canvas: HTMLCanvasElement, ghost: Ghost, park: () => void): Promise<void> {
    const fade = !motion.still && !this.flight.flying && ghost.canvas !== undefined;

    this.#hold(true);

    if (fade) {
      // Drawn and taken in one task, while the canvas still holds the frame.
      this.#changed = true;
      this.#draw();

      const still = await createImageBitmap(canvas);

      ghost.canvas?.getContext("bitmaprenderer")?.transferFromImageBitmap(still);
      ghost.phase = "hold";
    }

    park();

    const compiled = await ahead(this.#studio, this.#isGone).catch(() => true);

    this.#hold(false);

    if (!compiled || !fade) return;

    // The frame with the cars is on the canvas before the held picture goes.
    await nextFrame();
    await gpuIdle(this.#studio.renderer);
    await nextFrame();

    if (ghost.phase === "hold") ghost.phase = "fade";
  }

  /* oxlint-enable typescript/prefer-readonly-parameter-types */

  dispose(): void {
    this.#gone = true;
    this.#unwatch();
    this.loop.pause("gone", true);
    this.#unglaze();
    clearTimeout(this.#later);
    cancelAnimationFrame(this.#frame);
    this.#burst.rest();
  }

  readonly #isGone = (): boolean => this.#gone;

  #glaze(target: Glass | null): void {
    this.#lens.aim(target);

    if (this.#resting()) return;

    this.#glazing ??= this.loop.keep((seconds) => {
      this.#studio.lens(this.#lens.at(seconds), seconds);

      // The loop's last frame is drawn through the lens as it stands.
      if (this.#resting()) this.#unglaze();
    });
  }

  /** Whether the lens owes no frame: it is clear, or frost alone has faded in and stands drawn
   * (ADR 23 "Motion": the loop stops when the weather turns dry). */
  #resting(): boolean {
    return this.#lens.clear || this.#lens.still;
  }

  #unglaze(): void {
    this.#glazing?.();
    this.#glazing = undefined;
  }

  #clear(): void {
    this.#lens.cut();
    this.#studio.lens(null, 0);
    this.#unglaze();
    this.render();
  }

  /** A frame at `now`: where the flight moved the camera is drawn in it, not the next. True
   * while the flight goes on. */
  #paint(now: number): boolean {
    const flying = this.flight.step(now);

    this.#changed ||= flying;
    this.#draw();

    return flying;
  }

  /** Draws; `drawn` hears of a changed picture alone, and not of rain that fell on. */
  #draw(): void {
    const changed = this.#changed;

    this.#changed = false;
    this.#studio.render();

    if (changed) this.#drawn();

    this.#burst.rest();

    // A picture that moves on in a 30th of a second is never settled.
    if (!this.loop.running) this.#burst.start();
  }

  #hold(on: boolean): void {
    this.#held = on;
    // Paused, it stops and asks for a frame, which waits while held; resumed, it draws.
    this.loop.pause("held", on);

    if (!on) this.render();
  }
}
