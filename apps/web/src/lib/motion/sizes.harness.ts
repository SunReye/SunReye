/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
// Test harness: the page's size observers, told by the test when it waits on a size rather than
// on the browser's next frame. The browser still tells them; a size is told once either way.
import { starved } from "./callbacks.harness.ts";

/** The browser lays out in 64ths of a pixel. */
const laid = (px: number) => Math.round(px * 64);

/** An element's boxes now, as a size observer is told of them. */
function entryOf(target: Element): ResizeObserverEntry {
  const style = getComputedStyle(target);
  const px = (name: string) => Number(style.getPropertyValue(name).replace("px", "")) || 0;

  const across = (a: string, b: string) =>
    px(`padding-${a}`) + px(`padding-${b}`) + px(`border-${a}-width`) + px(`border-${b}-width`);

  const outer = style.boxSizing === "border-box";
  const [width, height] = [px("width"), px("height")];
  const [wide, high] = [across("left", "right"), across("top", "bottom")];

  const content = outer
    ? { inlineSize: width - wide, blockSize: height - high }
    : { inlineSize: width, blockSize: height };

  const border = outer
    ? { inlineSize: width, blockSize: height }
    : { inlineSize: width + wide, blockSize: height + high };

  return {
    target,
    contentRect: new DOMRectReadOnly(
      px("padding-left"),
      px("padding-top"),
      content.inlineSize,
      content.blockSize,
    ),
    contentBoxSize: [content],
    borderBoxSize: [border],
    devicePixelContentBoxSize: [
      {
        inlineSize: content.inlineSize * devicePixelRatio,
        blockSize: content.blockSize * devicePixelRatio,
      },
    ],
  };
}

/** What an observer of `box` compares to tell a change. */
function sizeOf(entry: ResizeObserverEntry, box: ResizeObserverBoxOptions): string {
  const [size] = box === "border-box" ? entry.borderBoxSize : entry.contentBoxSize;

  return `${laid(size?.inlineSize ?? 0)}×${laid(size?.blockSize ?? 0)}`;
}

/** Every size observer made on the page. */
const observers = new Set<Observer>();

/** A size observer the harness reaches: it hears each size once, from the browser or the test. */
class Observer extends ResizeObserver {
  readonly #told: ResizeObserverCallback;
  readonly #boxes: Map<Element, ResizeObserverBoxOptions>;
  readonly #last: Map<Element, string>;

  constructor(told: ResizeObserverCallback) {
    const boxes = new Map<Element, ResizeObserverBoxOptions>();
    const last = new Map<Element, string>();

    super((entries, observer) => {
      if (starved) return;

      const news = entries.filter((entry) => {
        const size = sizeOf(entry, boxes.get(entry.target) ?? "content-box");
        const was = last.get(entry.target);

        last.set(entry.target, size);

        return size !== was;
      });

      if (news.length > 0) told(news, observer);
    });
    this.#told = told;
    this.#boxes = boxes;
    this.#last = last;
    observers.add(this);
  }

  override observe(target: Element, options?: ResizeObserverOptions): void {
    this.#boxes.set(target, options?.box ?? "content-box");
    super.observe(target, options);
  }

  override unobserve(target: Element): void {
    this.#boxes.delete(target);
    this.#last.delete(target);
    super.unobserve(target);
  }

  override disconnect(): void {
    this.#boxes.clear();
    this.#last.clear();
    super.disconnect();
  }

  /** Tells the sizes that changed since this observer was told last. */
  tell(): void {
    const entries = [...this.#boxes].flatMap(([target, box]) => {
      const entry = entryOf(target);
      const size = sizeOf(entry, box);

      if (this.#last.get(target) === size) return [];

      this.#last.set(target, size);

      return [entry];
    });

    if (entries.length > 0) this.#told(entries, this);
  }
}

/** Puts the page's size observers where `resized` reaches them: for `page.setup.ts`. */
export function watchSizes(): void {
  globalThis.ResizeObserver = Observer;
}

/** Tells every size observer of each size that changed since it was told last, as the browser
 * would on its next frame. */
export function resized(): void {
  for (const observer of observers) observer.tell();
}
