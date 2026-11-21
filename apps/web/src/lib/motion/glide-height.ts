/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
// A card's height glides when its content changes it (ADR 21 "One behaviour, one component").
import type { Attachment } from "svelte/attachments";

interface Glide {
  readonly animation: Animation;
  readonly from: number;
  readonly to: number;
}

/** The move token in ms: 0 on the still tier and under reduced motion. */
const moveMs = (style: CSSStyleDeclaration) =>
  Number(style.getPropertyValue("--motion-move").trim().replace(/ms$/u, "")) || 0;

/** A card's height as its content sets it, and the glide to it. */
class Height {
  readonly #card: HTMLElement;
  /** The card's size as its content sets it, once first told: a card that mounts does not glide. */
  #size: { width: number; height: number } | undefined;
  #glide: Glide | undefined;

  constructor(card: HTMLElement) {
    this.#card = card;
  }

  /** Its content changed: from the height drawn to the content's, unless its width changed. */
  changed(): void {
    const was = this.#glide;
    const drawn = was === undefined ? this.#size?.height : this.#card.offsetHeight;
    const at = was?.animation.currentTime ?? null;

    this.stop();

    const { offsetWidth: width, offsetHeight: height } = this.#card;
    const widened = this.#size !== undefined && this.#size.width !== width;

    this.#size = { width, height };

    if (drawn === undefined || widened || drawn === height) return;

    // The glide's own clamp resized a child that fills the card: the same glide carries on.
    if (was?.to === height) this.#run(was.from, height, at);
    else this.#run(drawn, height, null);
  }

  /** The card alone resized, a row it stands in grew or shrank around it: nothing to glide. */
  resized(): void {
    if (this.#glide !== undefined) return;

    this.#size = { width: this.#card.offsetWidth, height: this.#card.offsetHeight };
  }

  stop(): void {
    this.#glide?.animation.cancel();
    this.#glide = undefined;
  }

  // `min-height` and `max-height`, not `height`: a child's percentage height stays `auto`, so a
  // chart sized to the card does not resize on every frame. The card's `overflow: hidden` clips.
  #run(from: number, to: number, at: CSSNumberish | null): void {
    const style = getComputedStyle(this.#card);
    const duration = moveMs(style);

    if (duration === 0) return;

    const animation = this.#card.animate(
      { minHeight: [`${from}px`, `${to}px`], maxHeight: [`${from}px`, `${to}px`] },
      { duration, easing: style.getPropertyValue("--motion-ease-in-out").trim() },
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
 * tier and a card that mounts take the new height at once. It hears the card's children, not the
 * card, whose size the glide itself changes.
 */
export const glideHeight: Attachment<HTMLElement> = (card) => {
  const height = new Height(card);

  const sizes = new ResizeObserver((entries) => {
    if (entries.some((entry) => entry.target !== card)) height.changed();
    else height.resized();
  });

  sizes.observe(card);

  for (const child of card.children) sizes.observe(child);

  const children = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.removedNodes) if (node instanceof Element) sizes.unobserve(node);

      for (const node of record.addedNodes) if (node instanceof Element) sizes.observe(node);
    }

    height.changed();
  });

  children.observe(card, { childList: true });

  return () => {
    children.disconnect();
    sizes.disconnect();
    height.stop();
  };
};
