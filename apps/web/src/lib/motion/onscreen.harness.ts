/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
// Test harness: the page's on-screen observers, told by the test when it waits on what shows
// rather than on the browser's next frame. The browser still tells them; a change is told once.

/** What `target` shows of itself in the window, as an observer with no root and no margin sees. */
function entryOf(target: Element): IntersectionObserverEntry {
  const bounds = target.getBoundingClientRect();
  const left = Math.max(bounds.left, 0);
  const top = Math.max(bounds.top, 0);
  const right = Math.min(bounds.right, innerWidth);
  const bottom = Math.min(bounds.bottom, innerHeight);
  const isIntersecting = target.isConnected && right >= left && bottom >= top;

  const shown = isIntersecting
    ? new DOMRectReadOnly(left, top, right - left, bottom - top)
    : new DOMRectReadOnly();

  const area = bounds.width * bounds.height;

  return {
    target,
    boundingClientRect: bounds,
    rootBounds: new DOMRectReadOnly(0, 0, innerWidth, innerHeight),
    intersectionRect: shown,
    intersectionRatio: area > 0 ? (shown.width * shown.height) / area : Number(isIntersecting),
    isIntersecting,
    time: Number(document.timeline.currentTime),
  };
}

/** Every on-screen observer of the window made on the page. */
const observers = new Set<Observer>();

/** An on-screen observer the harness reaches: it hears each change once, from the browser or the
 * test. Only one of the window with no margin is told by the test: the page makes no other. */
class Observer extends IntersectionObserver {
  readonly #told: IntersectionObserverCallback;
  readonly #targets = new Set<Element>();
  readonly #last: Map<Element, boolean>;

  constructor(told: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    const last = new Map<Element, boolean>();

    super((entries, observer) => {
      const news = entries.filter((entry) => {
        const was = last.get(entry.target);

        last.set(entry.target, entry.isIntersecting);

        return was !== entry.isIntersecting;
      });

      if (news.length > 0) told(news, observer);
    }, options);
    this.#told = told;
    this.#last = last;

    if (options?.root === undefined && (options?.rootMargin ?? "0px") === "0px")
      observers.add(this);
  }

  override observe(target: Element): void {
    this.#targets.add(target);
    super.observe(target);
  }

  override unobserve(target: Element): void {
    this.#targets.delete(target);
    this.#last.delete(target);
    super.unobserve(target);
  }

  override disconnect(): void {
    this.#targets.clear();
    this.#last.clear();
    super.disconnect();
  }

  /** Tells what came into or left the window since this observer was told last. */
  tell(): void {
    const entries = [...this.#targets].flatMap((target) => {
      const entry = entryOf(target);

      if (this.#last.get(target) === entry.isIntersecting) return [];

      this.#last.set(target, entry.isIntersecting);

      return [entry];
    });

    if (entries.length > 0) this.#told(entries, this);
  }
}

/** Puts the page's on-screen observers where `scrolled` reaches them: for `page.setup.ts`. */
export function watchScreen(): void {
  globalThis.IntersectionObserver = Observer;
}

/** Tells every on-screen observer of each element that came into or left the window since it was
 * told last, as the browser would on its next frame. */
export function scrolled(): void {
  for (const observer of observers) observer.tell();
}
