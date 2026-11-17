// The live stream (ADR 9): a snapshot, then each change, reconnecting until stopped. A page holds
// one, shared by every listener, and closes it while hidden (ADR 21).
import { refusal, type Client, type Problem } from "./client";
import { events, type Message } from "./events";
import { merge, parseFrame, type Values } from "./frames";

export type { Values } from "./frames";

/** Every live value, or why the core refused the stream. */
export type Live = Values | Problem;

/** The wait before reconnecting after a refusal or a failure. */
const RETRY_MS = 1000;

/** Twice the core's 15 s keep-alive: a line this quiet is gone, even if no error says so. */
const SILENCE_MS = 30_000;

/** Whether the page shows, and word when that changes: the browser's `document`. */
export type Visibility = Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;

/**
 * One stream for every listener, open while any listens and the page shows. A listener that joins
 * a running stream gets its latest values first, as its own snapshot would have.
 */
export function shared(
  client: Client,
  page: Visibility | undefined,
): (listener: (live: Live) => void) => () => void {
  const listeners = new Set<(live: Live) => void>();
  let latest: Live | undefined;
  let abort: AbortController | undefined;

  const fan = (live: Live) => {
    latest = live;

    for (const listener of listeners) listener(live);
  };

  const toVisibility = () => {
    if (page?.hidden === true) {
      abort?.abort();
      abort = undefined;
    } else if (abort === undefined) {
      abort = new AbortController();
      until(abort.signal, client, fan, latest);
    }
  };

  return (listener) => {
    listeners.add(listener);

    if (listeners.size === 1) {
      page?.addEventListener("visibilitychange", toVisibility);
      toVisibility();
    } else {
      // Not at once: callers subscribe inside effects, which would track what the listener reads.
      queueMicrotask(() => {
        if (latest !== undefined && listeners.has(listener)) listener(latest);
      });
    }

    return () => {
      if (!listeners.delete(listener) || listeners.size > 0) return;

      page?.removeEventListener("visibilitychange", toVisibility);
      abort?.abort();
      abort = undefined;
      latest = undefined;
    };
  };
}

/** Follows the stream until `signal` aborts; a frame still in flight then reaches no one. */
function until(
  signal: AbortSignal,
  client: Client,
  listener: (live: Live) => void,
  last: Live | undefined,
): void {
  void follow(
    client,
    (live) => {
      if (!signal.aborted) listener(live);
    },
    signal,
    last,
  );
}

/**
 * Streams until stopped: a clean end reconnects at once to a fresh snapshot (ADR 9). A stream that
 * breaks hands its last values on once more, marked `lost`, until a snapshot replaces them.
 */
async function follow(
  client: Client,
  listener: (live: Live) => void,
  signal: AbortSignal,
  last?: Live,
): Promise<void> {
  let latest = last;

  const snapshot = await stream(
    client,
    (live) => {
      latest = live;
      listener(live);
    },
    signal,
  ).catch(() => false);

  if (!snapshot) {
    if (
      !signal.aborted &&
      latest !== undefined &&
      "devices" in latest &&
      latest.lost === undefined
    ) {
      latest = { ...latest, lost: Date.now() };
      listener(latest);
    }

    await sleep(RETRY_MS, signal);
  }

  // Not awaited, so a core that runs for months builds no chain of promises.
  if (!signal.aborted) void follow(client, listener, signal, latest);
}

/** Follows one stream to its end; resolves whether it delivered a snapshot. */
async function stream(
  client: Client,
  listener: (live: Live) => void,
  signal: AbortSignal,
): Promise<boolean> {
  const watch = silenceWatch(signal);

  try {
    const { data, error, response } = await client.GET("/api/v1/live", {
      parseAs: "stream",
      signal: watch.signal,
    });

    if (error !== undefined) {
      listener(refusal(error, response.status));

      return false;
    }

    let values: Values | undefined;

    const fold = new WritableStream<Message>({
      write: ({ name, data: json }) => {
        const frame = parseFrame(json);

        if (frame !== undefined && (name === "snapshot" || values !== undefined)) {
          values = merge(name === "snapshot" ? undefined : values, frame, Date.now());
          listener(values);
        }
      },
    });

    await data?.pipeThrough(watch.bytes).pipeThrough(events()).pipeTo(fold, {
      signal: watch.signal,
    });

    return values !== undefined;
  } finally {
    watch.stop();
  }
}

/**
 * Aborts a stream that has been quiet for {@link SILENCE_MS}. Every byte through `bytes` counts,
 * keep-alives included: the parser drops those before an event reaches the listener.
 */
function silenceWatch(outer: AbortSignal) {
  const silence = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const heard = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      silence.abort();
    }, SILENCE_MS);
  };

  heard();

  return {
    signal: AbortSignal.any([outer, silence.signal]),
    bytes: new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller) => {
        heard();
        controller.enqueue(chunk);
      },
    }),
    stop: () => {
      clearTimeout(timer);
    },
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const timer = setTimeout(resolve, ms);

  signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      resolve();
    },
    { once: true },
  );

  return promise;
}
