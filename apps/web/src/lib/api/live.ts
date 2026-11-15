// The live stream (ADR 9): a snapshot, then each change, reconnecting until stopped.
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

/**
 * Streams until stopped: a clean end reconnects at once to a fresh snapshot (ADR 9). A stream that
 * breaks hands its last values on once more, marked `lost`, until a snapshot replaces them.
 */
export async function follow(
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
