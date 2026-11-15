// What a journey records inside the page: every frame's interval while it runs, the Long
// Animation Frames with their blocking time, and how long each pointer press waited for its handler.

export interface Recording {
  /** ms between consecutive frames. */
  readonly frames: readonly number[];
  readonly loaf: readonly {
    readonly duration: number;
    readonly blocking: number;
    /** The longest script in the frame: its invoker, file and duration. */
    readonly script: string;
  }[];
  /** ms from each pointer press to its first handler. */
  readonly delays: readonly number[];
  /** The motion tier the page ended on. */
  readonly tier: string;
}

declare global {
  interface Window {
    smoothness: { start(): void; stop(): Recording };
  }
}

type Script = Readonly<{ duration: number; invoker: string; sourceURL: string }>;

type Loaf = Recording["loaf"][number];

/** The longest script of a Long Animation Frame: its invoker, file and duration. */
function longest(scripts: readonly Script[]): string {
  const top = scripts.toSorted((a, b) => b.duration - a.duration)[0];

  return top
    ? `${top.invoker} ${top.sourceURL.split("/").at(-1)} ${Math.round(top.duration)} ms`
    : "";
}

/** A Long Animation Frame entry as recorded; undefined for any other entry. */
function loafOf(entry: Readonly<PerformanceEntry>): Loaf | undefined {
  if (!("blockingDuration" in entry && "scripts" in entry && Array.isArray(entry.scripts)))
    return undefined;

  return {
    duration: Math.round(entry.duration),
    blocking: Math.round(Number(entry.blockingDuration)),
    script: longest(entry.scripts),
  };
}

function install(): void {
  let on = false;
  let last = 0;
  let frames: number[] = [];
  let loaf: Loaf[] = [];
  let delays: number[] = [];

  const tick = (at: number) => {
    if (!on) return;

    if (last > 0) frames.push(at - last);

    last = at;
    requestAnimationFrame(tick);
  };

  new PerformanceObserver((list: Readonly<PerformanceObserverEntryList>) => {
    if (on)
      loaf.push(
        ...list.getEntries().flatMap((entry: Readonly<PerformanceEntry>) => loafOf(entry) ?? []),
      );
  }).observe({ type: "long-animation-frame" });

  // A press's timestamp is when the browser took it; the gap to its first handler is its delay.
  const pressed = (event: Readonly<Pick<PointerEvent, "timeStamp">>) => {
    if (on) delays.push(performance.now() - event.timeStamp);
  };

  addEventListener("pointerdown", pressed, { capture: true });

  window.smoothness = {
    start: () => {
      [frames, loaf, delays, on, last] = [[], [], [], true, 0];
      requestAnimationFrame(tick);
    },
    stop: () => {
      on = false;

      return { frames, loaf, delays, tier: document.documentElement.dataset["motion"] ?? "" };
    },
  };
}

/** The probe as a script for the page to run before its own: it installs `window.smoothness`. */
export const PROBE = [longest, loafOf, install, "install();"].map(String).join("\n");
