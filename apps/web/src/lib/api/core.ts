import createClient from "openapi-fetch";
import { events, type Message } from "./events";
import { merge, parseFrame, type Values } from "./frames";
import { body, type LayoutChange } from "./layout-change";
import type { components, paths } from "./schema";

type Client = ReturnType<typeof createClient<paths>>;

type ProblemDetails = components["schemas"]["ProblemDetails"];

export type History = components["schemas"]["History"];

export type Forecasts = components["schemas"]["Forecasts"];

export type Layout = components["schemas"]["Layout"];

export type StringDraft = components["schemas"]["StringDraft"];

export type ModuleType = components["schemas"]["ModuleType"];

export type Capabilities = components["schemas"]["Support"];

export type Device = components["schemas"]["Device"];

export type Setting = components["schemas"]["SettingSupport"];

/** A setting's declared values: a range or its values, and a step. */
export type Declared = components["schemas"]["Declared"];

/** An update waiting for a profile served, with what it changes (ADR 8). */
export type Update = components["schemas"]["Update"];

/** One write attempt as the write log keeps it (ADR 7). */
export type Attempt = components["schemas"]["Entry"];

export type WriteLog = components["schemas"]["WriteLog"];

/** A refusal's stable code (ADR 9), such as `auth.required`. */
export interface Problem {
  readonly problem: string;
}

export type { Values } from "./frames";

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
  /** Every module type. */
  moduleTypes(): Promise<readonly ModuleType[] | Problem>;
  /** Changes the PV layout from an instant on; admin only. */
  changeLayout(change: LayoutChange): Promise<Layout | Problem>;
  /** Every registered device; admin only. */
  devices(): Promise<readonly Device[] | Problem>;
  /** What the core supports, and each device's settings. */
  capabilities(): Promise<Capabilities | Problem>;
  /** Writes `value` to a device's setting through the core's one funnel; admin only. */
  write(device: number, key: string, value: number): Promise<Attempt | Problem>;
  /** Every write attempt, oldest first; admin only. */
  writes(): Promise<WriteLog | Problem>;
  /** Enables a device's setting as declared now, or withdraws the enable; admin only. */
  enable(device: number, key: string, on: boolean): Promise<Problem | undefined>;
  /** The profile updates waiting for the admin; admin only. */
  updates(): Promise<readonly Update[] | Problem>;
  /** Applies the update waiting for profile `id`; admin only. */
  apply(id: string): Promise<Update | Problem>;
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
    ...layouts(client),
    ...settings(client),
    ...trust(client),
  };
}

/** The PV layout and its module types (ADR 17, 20). */
function layouts(client: Client): Pick<Core, "layout" | "moduleTypes" | "changeLayout"> {
  return {
    layout: async () => {
      const { data, error, response } = await client.GET("/api/v1/layout");

      return data ?? refusal(error, response.status);
    },
    moduleTypes: async () => {
      const { data, error, response } = await client.GET("/api/v1/module-types");

      return data ? data.moduleTypes : refusal(error, response.status);
    },
    changeLayout: async (change) => {
      const { data, error, response } = await client.PUT("/api/v1/layout", { body: body(change) });

      return data ?? refusal(error, response.status);
    },
  };
}

/** Per-setting enables and profile updates (ADR 8). */
function trust(client: Client): Pick<Core, "enable" | "updates" | "apply"> {
  return {
    enable: async (device, key, on) => {
      const path = "/api/v1/devices/{id}/settings/{key}/enabled";
      const params = { path: { id: device, key } };

      const { error, response } = on
        ? await client.PUT(path, { params })
        : await client.DELETE(path, { params });

      return response.ok ? undefined : refusal(error ?? "", response.status);
    },
    updates: async () => {
      const { data, error, response } = await client.GET("/api/v1/profile-updates");

      return data ? data.updates : refusal(error, response.status);
    },
    apply: async (id) => {
      const { data, error, response } = await client.POST("/api/v1/profile-updates/{id}", {
        params: { path: { id } },
      });

      return data ?? refusal(error, response.status);
    },
  };
}

/** Devices, capabilities, setting writes and the write log. */
function settings(client: Client): Pick<Core, "devices" | "capabilities" | "write" | "writes"> {
  return {
    devices: async () => {
      const { data, error, response } = await client.GET("/api/v1/devices");

      return data ? data.devices : refusal(error, response.status);
    },
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
