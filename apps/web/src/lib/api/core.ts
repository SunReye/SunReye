import createClient from "openapi-fetch";
import { carBodies, type CarBodies } from "./car-bodies";
import { refusal, type Client, type Problem } from "./client";
import { imports, type Imports } from "./imports";
import { follow, type Live } from "./live";
import { body, type LayoutChange } from "./layout-change";
import { pvModel, type PvModel } from "./model";
import { setup, type Connection, type Setup } from "./setup";
import type { components, paths } from "./schema";

export type History = components["schemas"]["History"];

export type Forecasts = components["schemas"]["Forecasts"];

export type Statistics = components["schemas"]["Statistics"];

/** A plant-local calendar period statistics are cut in (ADR 3). */
export type Period = components["schemas"]["Period"];

export type Layout = components["schemas"]["Layout"];

export type StringDraft = components["schemas"]["StringDraft"];

export type PvString = components["schemas"]["PvString"];

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

export type { Problem } from "./client";

export type { ImportStatus, SharedArchive } from "./imports";

export type { Connection, Found, PointDraft } from "./setup";

export type { Live, Values } from "./live";

export type { Corrections } from "./model";

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
export interface Core extends Setup, CarBodies, Imports, PvModel {
  /** Calls `listener` with every value on connect and after each change, until the returned stop. */
  live(listener: (live: Live) => void): () => void;
  /** Time-weighted means of one series from `from` to before `to`, at the tier the core picks. */
  history(device: number, series: string, from: Date, to: Date): Promise<History | Problem>;
  /** One series' figures per plant-local period starting from `from` to before `to`. */
  statistics(
    device: number,
    series: string,
    period: Period,
    from: Date,
    to: Date,
  ): Promise<Statistics | Problem>;
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
  /** The core's standing problems, such as an unsynced clock. */
  problems(): Promise<readonly components["schemas"]["Condition"][] | Problem>;
  /** Every connection, a broker with its observed state; admin only. */
  connections(): Promise<readonly Connection[] | Problem>;
  /** The core's last log lines, oldest first; admin only, as a line may name a host (ADR 2). */
  logs(): Promise<readonly string[] | Problem>;
}

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
        params: { path: { id: device }, query: span(series, from, to) },
      });

      return data ?? refusal(error, response.status);
    },
    statistics: async (device, series, period, from, to) => {
      const { data, error, response } = await client.GET("/api/v1/devices/{id}/statistics", {
        params: {
          path: { id: device },
          query: { series, period, from: from.toISOString(), to: to.toISOString() },
        },
      });

      return data ?? refusal(error, response.status);
    },
    forecasts: async (device, series, from, to) => {
      const { data, error, response } = await client.GET("/api/v1/devices/{id}/forecasts", {
        params: { path: { id: device }, query: span(series, from, to) },
      });

      return data ?? refusal(error, response.status);
    },
    ...layouts(client),
    ...settings(client),
    ...trust(client),
    ...setup(client),
    ...carBodies(client),
    ...imports(client),
    ...pvModel(client),
    ...status(client),
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

/** The status and logs screen's reads (ADR 11). */
function status(client: Client): Pick<Core, "problems" | "connections" | "logs"> {
  return {
    problems: async () => {
      const { data, error, response } = await client.GET("/api/v1/problems");

      return data ? data.problems : refusal(error, response.status);
    },
    connections: async () => {
      const { data, error, response } = await client.GET("/api/v1/connections");

      return data ? data.connections : refusal(error, response.status);
    },
    logs: async () => {
      const { data, error, response } = await client.GET("/api/v1/logs");

      return data ? data.lines : refusal(error, response.status);
    },
  };
}

/** One series over a span, as the history and forecast routes take it. */
function span(series: string, from: Readonly<Date>, to: Readonly<Date>) {
  return { series, from: from.toISOString(), to: to.toISOString() };
}
