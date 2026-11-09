import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

type Client = ReturnType<typeof createClient<paths>>;

type ProblemDetails = components["schemas"]["ProblemDetails"];

export type History = components["schemas"]["History"];

export type Forecasts = components["schemas"]["Forecasts"];

export type Layout = components["schemas"]["Layout"];

export type Capabilities = components["schemas"]["Support"];

export type Setting = components["schemas"]["SettingSupport"];

/** One write attempt as the write log keeps it (ADR 7). */
export type Attempt = components["schemas"]["Entry"];

export type WriteLog = components["schemas"]["WriteLog"];

/** A refusal's stable code (ADR 9), such as `auth.required`. */
export interface Problem {
  readonly problem: string;
}

/** Live values by device id, then by series name, such as `pv.mppt.power[2]`. */
export interface Values {
  readonly devices: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

/** Every live value, or why the core refused the stream. */
export type Live = Values | Problem;

/**
 * How the SPA reaches a core (ADR 11): plain HTTP to its own core now, the relay's tunnel later.
 * The live stream goes through it too, as a streamed response body.
 */
export interface Transport {
  /** The core's root, ending in `/`; API paths resolve under it, so a prefix carries through. */
  readonly base: string;
  readonly fetch: (request: Request) => Promise<Response>;
}

/** The core that served the page, at `base`. */
export function http(base: string): Transport {
  return { base, fetch: (request) => fetch(request) };
}

/** A core's API: what the SPA reads, through one transport. */
export interface Core {
  /** Calls `listener` with every value on connect and after each change, until the returned stop. */
  live(listener: (live: Live) => void): () => void;
  /** Time-weighted means of one series from `from` to before `to`, at the tier the core picks. */
  history(device: number, series: string, from: Date, to: Date): Promise<History | Problem>;
  /** The latest forecast of each target of one series from `from` to before `to`. */
  forecasts(device: number, series: string, from: Date, to: Date): Promise<Forecasts | Problem>;
  /** The PV layout in force now. */
  layout(): Promise<Layout | Problem>;
  /** What the core supports, and each device's settings. */
  capabilities(): Promise<Capabilities | Problem>;
  /** Writes `value` to a device's setting through the core's one funnel; admin only. */
  write(device: number, key: string, value: number): Promise<Attempt | Problem>;
  /** Every write attempt, oldest first; admin only. */
  writes(): Promise<WriteLog | Problem>;
}

/** The wait before reconnecting after a refusal or a failure. */
const RETRY_MS = 1000;

export function connect(transport: Transport): Core {
  const client = createClient<paths>({ baseUrl: transport.base, fetch: transport.fetch });

  return {
    live: (listener) => {
      const abort = new AbortController();
      void follow(client, listener, abort.signal);

      return () => {
        abort.abort();
      };
    },
    history: async (device, series, from, to) => {
      const { data, error, response } = await client.GET("/api/v1/devices/{id}/history", {
        params: {
          path: { id: device },
          query: { series, from: from.toISOString(), to: to.toISOString() },
        },
      });

      return data ?? refusal(error, response.status);
    },
    forecasts: async (device, series, from, to) => {
      const { data, error, response } = await client.GET("/api/v1/devices/{id}/forecasts", {
        params: {
          path: { id: device },
          query: { series, from: from.toISOString(), to: to.toISOString() },
        },
      });

      return data ?? refusal(error, response.status);
    },
    layout: async () => {
      const { data, error, response } = await client.GET("/api/v1/layout");

      return data ?? refusal(error, response.status);
    },
    ...settings(client),
  };
}

/** Capabilities, setting writes and the write log. */
function settings(client: Client): Pick<Core, "capabilities" | "write" | "writes"> {
  return {
    capabilities: async () => {
      const { data, error, response } = await client.GET("/api/v1/capabilities");

      return data ?? refusal(error, response.status);
    },
    write: async (device, key, value) => {
      const { data, error, response } = await client.PUT("/api/v1/devices/{id}/settings/{key}", {
        params: { path: { id: device, key } },
        body: { value },
      });

      return data ?? refusal(error, response.status);
    },
    writes: async () => {
      const { data, error, response } = await client.GET("/api/v1/writes");

      return data ?? refusal(error, response.status);
    },
  };
}

/** Streams until stopped: a clean end reconnects at once to a fresh snapshot (ADR 9). */
async function follow(
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
        values = name === "snapshot" ? frame : merge(values, frame);
        listener(values);
      }
    },
  });

  await data?.pipeThrough(events()).pipeTo(fold, { signal });

  return values !== undefined;
}

/** A proxy in front of the core may refuse with a body that is no JSON; its status stands in. */
function refusal(error: Readonly<ProblemDetails> | string, status: number): Problem {
  return { problem: error instanceof Object ? error.code : `http.${status}` };
}

interface Message {
  readonly name: string;
  readonly data: string;
}

/** Server-sent events from a body's bytes; comments and keep-alives yield nothing. */
function events(): TransformStream<Uint8Array, Message> {
  const decoder = new TextDecoder();
  let buffer = "";

  return new TransformStream({
    transform: (chunk, controller) => {
      buffer += decoder.decode(chunk, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const parsed = message(block);

        if (parsed.data !== "") controller.enqueue(parsed);
      }
    },
  });
}

function message(block: string): Message {
  const fields = block.split("\n").map((line) => {
    const colon = line.indexOf(":");

    return [line.slice(0, colon), line.slice(colon + 1).trimStart()] as const;
  });

  return {
    name: fields.find(([field]) => field === "event")?.[1] ?? "message",
    data: fields
      .filter(([field]) => field === "data")
      .map(([, value]) => value)
      .join("\n"),
  };
}

function parseFrame(json: string): Values | undefined {
  const value: unknown = JSON.parse(json);

  return isFrame(value) ? value : undefined;
}

function isFrame(value: unknown): value is Values {
  return (
    value instanceof Object &&
    "devices" in value &&
    value.devices instanceof Object &&
    Object.values(value.devices).every((series) => isSeries(series))
  );
}

function isSeries(value: unknown): value is Readonly<Record<string, number>> {
  return value instanceof Object && Object.values(value).every((v) => Number.isFinite(v));
}

function merge(values: Values | undefined, delta: Values): Values {
  const changed = Object.keys(delta.devices).map(
    (device) => [device, { ...values?.devices[device], ...delta.devices[device] }] as const,
  );

  return { devices: { ...values?.devices, ...Object.fromEntries(changed) } };
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
