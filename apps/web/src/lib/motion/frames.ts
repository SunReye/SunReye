// Work spread over frames (ADR 21), on one animation-frame loop: a frame at 4× throttle holds about
// 50 ms, less than a screen or a chart's bars take to build at once.

interface Job {
  readonly at: number;
  readonly run: () => void;
}

/**
 * How long staged parts may build in one frame, in ms, leaving the rest of a 50 ms frame to style,
 * layout and paint. Fewer, fuller frames: each frame over 20 ms counts against the 95th percentile.
 */
const SLICE_MS = 24;

/** Frames counted by the loop; it stands still while nothing waits. */
let frame = 0;
let jobs: Job[] = [];

/** Staged parts in the order asked, each with the first frame it may fill in. */
let parts: Job[] = [];
let looping = false;

function loop(): void {
  if (looping) return;

  looping = true;
  requestAnimationFrame(tick);
}

/** The staged parts that are due, in order, while the frame's slice lasts; at least one. */
function fill(): void {
  const start = performance.now();

  while (parts[0] !== undefined && parts[0].at <= frame) {
    const [part] = parts.splice(0, 1);

    part?.run();

    if (performance.now() - start >= SLICE_MS) break;
  }
}

function tick(): void {
  frame += 1;
  looping = false;

  const due = jobs.filter((j) => j.at <= frame);

  jobs = jobs.filter((j) => j.at > frame);

  for (const j of due) j.run();

  fill();

  if (jobs.length > 0 || parts.length > 0) loop();
}

/**
 * Runs `run` `n` frames on: 1 is this frame's own animation callbacks, before it paints; 2 the next
 * frame. Returns a cancel.
 */
export function after(n: number, run: () => void): () => void {
  const job: Job = { at: frame + n, run };

  jobs.push(job);
  loop();

  return () => {
    jobs = jobs.filter((j) => j !== job);
  };
}

/**
 * Builds a part of an arriving screen after the frame that mounts the screen, in the order asked,
 * as many a frame as fit its slice. `run` must build the part before it returns, so its cost
 * counts. Returns a cancel.
 */
export function stage(run: () => void): () => void {
  const part: Job = { at: frame + 2, run };

  parts.push(part);
  loop();

  return () => {
    parts = parts.filter((p) => p !== part);
  };
}
