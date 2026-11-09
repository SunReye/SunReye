// The live stream (ADR 9): a snapshot, then each change, reconnecting until stopped.
import { refusal, type Client, type Problem } from "./client";
import { events, type Message } from "./events";
import { merge, parseFrame, type Values } from "./frames";

export type { Values } from "./frames";

/** Every live value, or why the core refused the stream. */
export type Live = Values | Problem;

/** The wait before reconnecting after a refusal or a failure. */
const RETRY_MS = 1000;

/** Streams until stopped: a clean end reconnects at once to a fresh snapshot (ADR 9). */
export async function follow(
  client: Client,
  listener: (live: Live) => void,
  signal: AbortSignal,
): Promise<void> {
  const snapshot = await stream(client, listener, signal).catch(() => false);

  if (!snapshot) await sleep(RETRY_MS, signal);

  // Not awaited, so a core that runs for months builds no chain of promises.
  if (!signal.aborted) void follow(client, listener, signal);
}

/** Follows one stream to its end; resolves whether it delivered a snapshot. */
async function stream(
  client: Client,
  listener: (live: Live) => void,
  signal: AbortSignal,
): Promise<boolean> {
  const { data, error, response } = await client.GET("/api/v1/live", {
    parseAs: "stream",
    signal,
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

  await data?.pipeThrough(events()).pipeTo(fold, { signal });

  return values !== undefined;
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
