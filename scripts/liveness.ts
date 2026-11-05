/**
 * Deadlines for the harnesses that drive a loaded core (`./budgets-run.ts`): each bounds how long the
 * core may go without making progress, never how fast it answers. A budget measures resident memory
 * and bytes, not availability.
 */

export type Time = {
  now: () => number;
  pause: (ms: number) => Promise<void>;
};

const real: Time = {
  now: () => Date.now(),
  pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** A busy core is given this long to answer one request: a loaded host stalls it for minutes. */
const BUSY_DEADLINE_MS = 300_000;

const DEFAULT_RETRY_MS = 1000;

/** The wait a 503 asks for in `Retry-After` seconds; a second when absent or not a positive number. */
function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_MS;
}

/**
 * The answer to `request`, asked again after each 503's `Retry-After` while the core is busy. Gives up
 * only when the next wait would pass `deadlineMs` since the first ask; any other answer, a failure
 * included, is returned for the caller to judge.
 */
export async function whileBusy(
  what: string,
  request: () => Promise<Response>,
  { deadlineMs = BUSY_DEADLINE_MS, now, pause }: Partial<Time> & { deadlineMs?: number } = {},
): Promise<Response> {
  const time = { ...real, ...(now && { now }), ...(pause && { pause }) };
  const start = time.now();
  for (;;) {
    const response = await request();
    if (response.status !== 503) return response;
    const wait = retryAfterMs(response);
    const waited = time.now() - start;
    if (waited + wait > deadlineMs) {
      throw new Error(`${what} still answers 503 after ${waited} ms: ${await response.text()}`);
    }
    await response.arrayBuffer();
    await time.pause(wait);
  }
}

export type Timers<Handle> = {
  set: (fire: () => void, ms: number) => Handle;
  clear: (handle: Handle) => void;
};

/**
 * Calls `onStall` once `ms` pass without a `beat`; each beat starts the wait again.
 * `Handle` is whatever the timers hand back.
 */
export function stallWatch<Handle = ReturnType<typeof setTimeout>>(
  ms: number,
  onStall: () => void,
  timers: Timers<Handle> = { set: setTimeout, clear: clearTimeout } as unknown as Timers<Handle>,
) {
  let handle = timers.set(onStall, ms);
  return {
    beat() {
      timers.clear(handle);
      handle = timers.set(onStall, ms);
    },
    stop() {
      timers.clear(handle);
    },
  };
}
