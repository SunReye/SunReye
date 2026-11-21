/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
// A card's height glides when its content changes it (ADR 21 "One behaviour, one component").
import type { Attachment } from "svelte/attachments";
import { tokenMs } from "../../../motion/token.ts";

const px = (value: string) => Number(value.replace(/px$/u, "")) || 0;

/** Where `child`'s margin box ends below `card`'s padding edge, or 0 for one out of the flow. */
function bottomOf(card: HTMLElement, child: Element): number {
  if (!(child instanceof HTMLElement)) return 0;

  const style = getComputedStyle(child);

  if (style.position === "absolute" || style.position === "fixed") return 0;

  // Layout offsets: a transform on the child, as a pane's slide, does not move them.
  const origin = child.offsetParent === card ? 0 : card.offsetTop + card.clientTop;

  return child.offsetTop - origin + child.offsetHeight + px(style.marginBottom);
}

/**
 * The height `card`'s content sets it, read past a glide: from where its last child ends, which
 * the glide's `min-height` and `max-height` do not move.
 */
function contentHeight(card: HTMLElement): number {
  const style = getComputedStyle(card);
  const end = Math.max(0, ...Array.from(card.children, (child) => bottomOf(card, child)));
  const edges = card.offsetHeight - card.clientHeight;

  return Math.max(end, px(style.paddingTop)) + px(style.paddingBottom) + edges;
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
    if (this.#glide !== undefined) {
      this.#moved(this.#glide);

      return;
    }

    const drawn = this.#height;
    const widened = this.#widened();
    const height = this.#measure();

    if (widened || drawn === undefined || drawn === height) return;

    this.#run(drawn, height);
  }

  /**
   * Its content changed mid-glide. A glide begun anew waits a frame to start, so one begun on each
   * frame of a swipe's slide would never move: the glide runs on unless the height it goes to moved.
   */
  #moved(glide: Glide): void {
    const height = contentHeight(this.#card);

    // Layout offsets are whole pixels: a pixel apart is where the glide goes.
    if (Math.abs(height - glide.to) <= 1) return;

    const drawn = this.#card.offsetHeight;

    this.stop();
    this.#height = height;
    this.#width = this.#card.offsetWidth;
    this.#run(drawn, height);
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
    this.#ended();
  }

  #ended(): void {
    this.#glide = undefined;
    delete this.#card.dataset["gliding"];
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
  #run(from: number, to: number): void {
    const duration = tokenMs(this.#card, "--motion-move");

    if (duration === 0) return;

    const animation = this.#card.animate(
      { minHeight: [`${from}px`, `${to}px`], maxHeight: [`${from}px`, `${to}px`] },
      {
        duration,
        easing: getComputedStyle(this.#card).getPropertyValue("--motion-ease-in-out").trim(),
      },
    );

    const glide: Glide = { animation, from, to };

    this.#glide = glide;
    // The content keeps its size, clipped, rather than squeezed to the glide's (`card.svelte`).
    this.#card.dataset["gliding"] = "";
    animation.addEventListener("finish", () => {
      if (this.#glide === glide) this.#ended();
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

    // The glide's own mark is no change of content.
    if (records.every((record) => record.attributeName === "data-gliding")) return;

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
