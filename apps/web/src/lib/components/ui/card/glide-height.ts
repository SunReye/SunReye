/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
// A card's height glides when its content changes it (ADR 21 "One behaviour, one component").
import type { Attachment } from "svelte/attachments";
import { tokenMs } from "../../../motion/token.ts";

interface Start {
  readonly from: number;
  readonly at: CSSNumberish | null;
}

interface Carried extends Start {
  readonly to: number;
}

/** What a change finds before it measures: the height drawn and the glide under way. */
interface Before {
  readonly drawn: number | undefined;
  readonly carried: Carried | undefined;
}

interface Glide {
  readonly animation: Animation;
  readonly from: number;
  readonly to: number;
}

/** A card's height as its content sets it, and the glide to it. */
class Height {
  readonly #card: HTMLElement;
  /** The card's height as its content sets it, once first told: a card that mounts does not glide. */
  #height: number | undefined;
  /** Its width when its content last changed: a change of width since is the window's. */
  #width: number | undefined;
  #glide: Glide | undefined;

  constructor(card: HTMLElement) {
    this.#card = card;
  }

  /** Its content changed: from the height drawn to the content's, unless its width changed. */
  changed(): void {
    const before = this.#before();
    const widened = this.#widened();
    const height = this.#measure();

    if (widened || before.drawn === undefined || before.drawn === height) return;

    this.#run(Height.#start(before.carried, before.drawn, height), height);
  }

  /** The height drawn and the glide under way, which stops. A cancelled animation has no time,
   * so it is read first. */
  #before(): Before {
    const was = this.#glide;

    if (was === undefined) return { drawn: this.#height, carried: undefined };

    const drawn = this.#card.offsetHeight;
    const carried = { from: was.from, to: was.to, at: was.animation.currentTime };

    this.stop();

    return { drawn, carried };
  }

  /** A change that leaves the height where the glide is going (a figure ticking) carries it on;
   * any other glides from the height drawn. */
  static #start(carried: Carried | undefined, drawn: number, height: number): Start {
    return carried?.to === height ? carried : { from: drawn, at: null };
  }

  /** The card resized with no change to its content (a row it stands in, the window): no glide.
   * Its width stays as its content last saw it, so a chart redrawn to a new width does not glide. */
  resized(): void {
    if (this.#glide === undefined) this.#height = this.#card.offsetHeight;

    this.#width ??= this.#card.offsetWidth;
  }

  /** The card's own frame changed: it takes its height at once. */
  reframed(): void {
    this.stop();
    this.#measure();
  }

  stop(): void {
    this.#glide?.animation.cancel();
    this.#glide = undefined;
  }

  /** Whether the card's width changed since its content last did: the window's change. */
  #widened(): boolean {
    return this.#width !== undefined && this.#width !== this.#card.offsetWidth;
  }

  #measure(): number {
    this.#height = this.#card.offsetHeight;
    this.#width = this.#card.offsetWidth;

    return this.#height;
  }

  // `min-height` and `max-height`, not `height`: a child's percentage height stays `auto`, so a
  // chart sized to the card does not resize on every frame. The card's `overflow: hidden` clips.
  #run(start: Start, to: number): void {
    const { from, at } = start;
    const duration = tokenMs(this.#card, "--motion-move");

    if (duration === 0) return;

    const animation = this.#card.animate(
      { minHeight: [`${from}px`, `${to}px`], maxHeight: [`${from}px`, `${to}px`] },
      {
        duration,
        easing: getComputedStyle(this.#card).getPropertyValue("--motion-ease-in-out").trim(),
      },
    );

    if (at !== null) animation.currentTime = at;

    const glide: Glide = { animation, from, to };

    this.#glide = glide;
    animation.addEventListener("finish", () => {
      if (this.#glide === glide) this.#glide = undefined;
    });
  }
}

/**
 * Glides `card`'s height from the one drawn to its content's whenever its content changes it, on
 * the move token, so what stands below moves with it. A change of width (the window's), the still
 * tier, a change to the card's own class or style and a card that mounts take the new height at
 * once.
 *
 * It hears the card's content change in the DOM, before the browser lays it out, so the glide
 * starts in the same frame and no size observer is told a size the glide then takes back.
 */
export const glideHeight: Attachment<HTMLElement> = (card) => {
  const height = new Height(card);

  const size = new ResizeObserver(() => {
    height.resized();
  });

  const content = new MutationObserver((records) => {
    // The card's own class or style: its frame changed (a screen's fullscreen), not its content.
    const reframed = records.some(
      (record) =>
        record.target === card &&
        (record.attributeName === "class" || record.attributeName === "style"),
    );

    if (reframed) height.reframed();
    else height.changed();
  });

  size.observe(card);
  content.observe(card, { subtree: true, childList: true, attributes: true, characterData: true });

  return () => {
    content.disconnect();
    size.disconnect();
    height.stop();
  };
};
