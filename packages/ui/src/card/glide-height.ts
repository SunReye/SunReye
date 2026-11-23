/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
// A card's height glides when its content changes it (ADR 21 "One behaviour, one component").
import type { Attachment } from "svelte/attachments";
import { easeInOut } from "../motion/ease.ts";
import { tokenMs } from "../motion/token.ts";

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

/** One change of the content's height under way: `by` px, begun `age` ms ago. */
interface Change {
  readonly by: number;
  readonly age: number;
}

/** Where a glide to `to` draws the card `ms` on, each change easing in over `duration`. */
const drawnAt = (to: number, changes: readonly Change[], duration: number, ms: number) =>
  changes.reduce((at, { by, age }) => at - by * (1 - easeInOut((age + ms) / duration)), to);

/** `changes` as they stand `ms` on: the ones played out are in the height the glide goes to. */
const aged = (changes: readonly Change[], duration: number, ms: number) =>
  changes.map(({ by, age }) => ({ by, age: age + ms })).filter(({ age }) => age < duration);

/** Heights along a glide, close enough that straight lines between them read as its curve. */
const SAMPLES = 32;

/** The glide as keyframes: both heights, so the card is neither squeezed nor stretched. */
function keyframes(to: number, changes: readonly Change[], duration: number) {
  const heights = Array.from(
    { length: SAMPLES + 1 },
    (_, i) => `${drawnAt(to, changes, duration, (i / SAMPLES) * duration)}px`,
  );

  return { minHeight: heights, maxHeight: heights };
}

/**
 * Plays `animation` over `frames` from their start. The same animation, sought: one begun anew
 * would wait for the next frame to start, and the card would stand still for it.
 */
function replay(animation: Animation, frames: ReturnType<typeof keyframes>): void {
  if (animation.effect instanceof KeyframeEffect) animation.effect.setKeyframes(frames);

  animation.currentTime = 0;
}

/** What is new in the card, held back until it has its height. */
interface Hold {
  readonly part: HTMLElement | SVGElement;
  readonly fade: Animation;
}

/**
 * Holds `part` back, unseen, for the glide's `duration`, then fades it in on the base token: the
 * card resizes first, then what is new in it comes in. Marked, so what builds up in it as it first
 * shows (a chart's entrance) waits for the card too (`card.svelte`).
 */
function heldBack(part: HTMLElement | SVGElement, duration: number): Hold {
  const whole = duration + tokenMs(part, "--motion-base");

  part.dataset["held"] = "";

  return {
    part,
    fade: part.animate(
      { opacity: [0, 0, 1], offset: [0, duration / whole, 1] },
      { duration: whole },
    ),
  };
}

/** The marks a glide sets: on the card, and on what it holds back. */
const MARKS: ReadonlySet<string | null> = new Set(["data-gliding", "data-held"]);

/** Content that arrives on a way of its own, as a pane that slides in, is seen all the way. */
const SHOWN = "[data-glide-shown]";

/** The elements `records` put into the card and left there, each the top of what came with it. */
function arrivals(records: readonly MutationRecord[]): (HTMLElement | SVGElement)[] {
  const put = records
    .flatMap((record) => [...record.addedNodes])
    .filter((node) => node instanceof HTMLElement || node instanceof SVGElement)
    .filter((part) => part.isConnected && !part.matches(SHOWN));

  return put.filter((part) => !put.some((other) => other !== part && other.contains(part)));
}

interface Glide {
  readonly animation: Animation;
  readonly held: readonly Hold[];
  readonly to: number;
  /** The changes under way when the animation was last at its start. */
  readonly changes: readonly Change[];
  readonly duration: number;
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

  /**
   * Its content changed, `arrived` new in it: from the height drawn to the content's, unless its
   * width changed.
   */
  changed(arrived: readonly (HTMLElement | SVGElement)[]): void {
    if (this.#glide !== undefined) {
      this.#moved(this.#glide, arrived);

      return;
    }

    const drawn = this.#height;
    const widened = this.#widened();
    const height = this.#measure();

    if (widened || drawn === undefined || drawn === height) return;

    this.#run(drawn, height, arrived);
  }

  /**
   * Its content changed mid-glide: the glide goes on unless the height it goes to moved. Then the
   * new change eases in over the ones under way, so the card keeps the speed it has: a glide begun
   * anew from rest on every change stutters, and one begun on each frame of a swipe never moves.
   * What is held back waits the glide out anew, with what `arrived` now.
   */
  #moved(glide: Glide, arrived: readonly (HTMLElement | SVGElement)[]): void {
    const height = contentHeight(this.#card);

    // Layout offsets are whole pixels: a pixel apart is where the glide goes.
    if (Math.abs(height - glide.to) <= 1) return;

    this.#height = height;
    this.#width = this.#card.offsetWidth;

    const { animation, duration } = glide;
    const under = aged(glide.changes, duration, Number(animation.currentTime));
    const changes = [...under, { by: height - glide.to, age: 0 }];

    replay(animation, keyframes(height, changes, duration));

    for (const hold of glide.held) hold.fade.currentTime = 0;

    const held = [...glide.held, ...arrived.map((part) => heldBack(part, duration))];

    this.#glide = { animation, held, to: height, changes, duration };
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

    for (const hold of this.#glide?.held ?? []) hold.fade.cancel();

    this.#ended();
  }

  /** The card has its height: what was held back comes in, and what builds up in it plays. */
  #ended(): void {
    for (const hold of this.#glide?.held ?? []) delete hold.part.dataset["held"];

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
  #run(from: number, to: number, arrived: readonly (HTMLElement | SVGElement)[]): void {
    const duration = tokenMs(this.#card, "--motion-move");

    if (duration === 0) return;

    const changes = [{ by: to - from, age: 0 }];
    const animation = this.#card.animate(keyframes(to, changes, duration), { duration });

    const held = arrived.map((part) => heldBack(part, duration));

    this.#glide = { animation, held, to, changes, duration };
    // The content keeps its size, clipped, rather than squeezed to the glide's (`card.svelte`).
    this.#card.dataset["gliding"] = "";
    animation.addEventListener("finish", () => {
      // An end told late, after a change sought the glide back to its start, is not its end.
      if (Number(animation.currentTime) >= duration) this.#ended();
    });
  }
}

/** Whether `outer`, a grid or a flex row, stretches a child styled `own` to its row's height. */
function stretched(outer: CSSStyleDeclaration, own: CSSStyleDeclaration): boolean {
  if (!/grid|flex/u.test(outer.display)) return false;

  const align = own.alignSelf === "auto" ? outer.alignItems : own.alignSelf;

  return align === "normal" || align === "stretch";
}

/**
 * Whether `card`'s height is its container's, not its content's: it grows into a column, or a row
 * or a grid stretches it. Gliding such a card fights its container: the glide pulls it to its
 * content, the container pulls it back, and it wobbles until both settle.
 */
function sizedByParent(card: HTMLElement): boolean {
  const parent = card.parentElement;

  if (parent === null) return false;

  const outer = getComputedStyle(parent);
  const own = getComputedStyle(card);

  if (/flex/u.test(outer.display) && outer.flexDirection.startsWith("column"))
    return Number(own.flexGrow) > 0;

  return stretched(outer, own);
}

/**
 * Glides `card`'s height from the one drawn to its content's whenever its content changes it, on
 * the move token and ADR 21's ease-in-out, so what stands below moves with it. What the change put
 * into the card is held back, unseen, until the card has its height, then fades in. A change
 * mid-glide eases in over the glide under way. A change of width (the window's), the still
 * tier, a change to the card's own class or style, a card its container sizes and a card that
 * mounts take the new height at once.
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

    // The glide's own marks are no change of content.
    if (records.every((record) => MARKS.has(record.attributeName))) return;

    // A card its container sizes takes its height at once, as one whose frame changed.
    if (reframed || sizedByParent(card)) height.reframed();
    else height.changed(arrivals(records));
  });

  size.observe(card);
  content.observe(card, { subtree: true, childList: true, attributes: true, characterData: true });

  return () => {
    content.disconnect();
    size.disconnect();
    height.stop();
  };
};
