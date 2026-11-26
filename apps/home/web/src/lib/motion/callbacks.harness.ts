/* oxlint-disable typescript/prefer-readonly-parameter-types -- the browser's callbacks, only called. */
// Test harness: the callbacks the page asks the browser for on its next frame or its next idle
// time, run by the test when it waits on them. The browser still runs each, unless the test ran it
// first: one run either way, never two.

/** Callbacks asked for, the browser's request for each kept to cancel when the test runs it. */
class Asked<Callback> {
  readonly #waiting = new Map<number, { readonly callback: Callback; readonly browsers: number }>();
  readonly #cancel: (id: number) => void;
  #last = 0;

  constructor(cancel: (id: number) => void) {
    this.#cancel = cancel;
  }

  /** Keeps `callback`, which the browser also runs through `browsers`, unless the test runs it. */
  ask(callback: Callback, browsers: (run: () => boolean) => number): number {
    this.#last += 1;

    const id = this.#last;

    this.#waiting.set(id, { callback, browsers: browsers(() => this.#waiting.delete(id)) });

    return id;
  }

  forget(id: number): void {
    const was = this.#waiting.get(id);

    this.#waiting.delete(id);

    if (was !== undefined) this.#cancel(was.browsers);
  }

  /** The callbacks asked for so far, each taken from the browser. */
  take(): Callback[] {
    const due = [...this.#waiting];

    for (const [id] of due) this.forget(id);

    return due.map(([, { callback }]) => callback);
  }
}

/**
 * The browser's frames withheld from the page (`VITE_STARVE_FRAMES=1`): its frame and idle
 * callbacks and its observers' entries reach the page only through the harness, so a test that
 * still waits on a frame of the browser's fails instead of passing on an idle machine.
 */
export const starved = import.meta.env["VITE_STARVE_FRAMES"] === "1";

let frames: Asked<FrameRequestCallback> | undefined;
let idles: Asked<IdleRequestCallback> | undefined;

/** The page's frame and idle requests, as the harness hands them out. */
let ownFrame: typeof requestAnimationFrame | undefined;
let ownIdle: typeof requestIdleCallback | undefined;

/** Puts the page's frame and idle callbacks where the harness reaches them: for `page.setup.ts`. */
export function watchCallbacks(): void {
  const browserFrame = globalThis.requestAnimationFrame.bind(globalThis);
  const browserIdle = globalThis.requestIdleCallback.bind(globalThis);

  const frameAsked = new Asked<FrameRequestCallback>(
    globalThis.cancelAnimationFrame.bind(globalThis),
  );

  const idleAsked = new Asked<IdleRequestCallback>(globalThis.cancelIdleCallback.bind(globalThis));

  ownFrame = (callback) =>
    frameAsked.ask(callback, (run) =>
      starved
        ? 0
        : browserFrame((now) => {
            if (run()) callback(now);
          }),
    );
  ownIdle = (callback, options) =>
    idleAsked.ask(callback, (run) =>
      starved
        ? 0
        : browserIdle((deadline) => {
            if (run()) callback(deadline);
          }, options),
    );
  frames = frameAsked;
  idles = idleAsked;
  globalThis.requestAnimationFrame = ownFrame;
  globalThis.cancelAnimationFrame = (id) => {
    frameAsked.forget(id);
  };

  globalThis.requestIdleCallback = ownIdle;
  globalThis.cancelIdleCallback = (id) => {
    idleAsked.forget(id);
  };
}

/** Whether the test fakes the page's frames (`vi.useFakeTimers`): its fake clock runs them. */
export const framesFaked = (): boolean => globalThis.requestAnimationFrame !== ownFrame;

/** Runs the frame callbacks asked for so far, as the next frame would; those they ask for wait for
 * the frame after. */
export function runFrameCallbacks(): void {
  // The time of the frame the page is on, as a frame callback is given it.
  const now = Number(document.timeline.currentTime);

  for (const callback of frames?.take() ?? []) callback(now);
}

/** Runs the idle callbacks asked for so far, as the browser does when it has nothing else to do;
 * unless the test fakes them, when its fake clock runs them. */
export function runIdleCallbacks(): void {
  if (globalThis.requestIdleCallback !== ownIdle) return;

  const deadline: IdleDeadline = { didTimeout: false, timeRemaining: () => 50 };

  for (const callback of idles?.take() ?? []) callback(deadline);
}
