// Work spread over frames (ADR 21), on one animation-frame loop: a frame at 4× throttle holds about
// 50 ms, less than a screen or a chart's bars take to build at once.

interface Job {
  readonly at: number;
  readonly run: () => void;
}

/** Frames counted by the loop; it stands still while nothing waits. */
let frame = 0;
/** The frame the last staged part was given. */
let staged = 0;
let jobs: Job[] = [];
let looping = false;

function tick(): void {
  frame += 1;

  const due = jobs.filter((j) => j.at <= frame);

  jobs = jobs.filter((j) => j.at > frame);
  looping = jobs.length > 0;

  if (looping) requestAnimationFrame(tick);

  for (const j of due) j.run();
}

function at(when: number, run: () => void): () => void {
  const job: Job = { at: when, run };

  jobs.push(job);

  if (!looping) {
    looping = true;
    requestAnimationFrame(tick);
  }

  return () => {
    jobs = jobs.filter((j) => j !== job);
  };
}

/**
 * Runs `run` `n` frames on: 1 is this frame's own animation callbacks, before it paints; 2 the next
 * frame. Returns a cancel.
 */
export function after(n: number, run: () => void): () => void {
  return at(frame + n, run);
}

/**
 * Gives a part of an arriving screen its own frame: the first after the one that mounts the screen,
 * then one each, in the order asked. Returns a cancel.
 */
export function stage(run: () => void): () => void {
  staged = Math.max(frame + 2, staged + 1);

  return at(staged, run);
}
