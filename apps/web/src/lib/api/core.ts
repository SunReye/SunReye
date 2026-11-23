import { remembering } from "./cache";
import { bySeries, open, refusal, type Client, type components, type Problem } from "./client";
import { imports, type Imports } from "./imports";
import { shared, type Live, type Visibility } from "./live";
import { layouts, type Layouts } from "./layouts";
import { setup, type Connection, type Setup } from "./setup";
import { reference, type Reference } from "./reference";
import { plantRecords, type PlantRecords } from "./records";
import { tariffs, type Tariffs } from "./tariff";
import { views, type Views } from "./views";

/** One series' history, forecasts or figures per period, by name (ADR 9). */
export type History = components["schemas"]["History"];

export type Forecasts = components["schemas"]["Forecasts"];

export type Statistics = components["schemas"]["Statistics"];

/** A device with stored history, present or removed, and its stored series (ADR 22). */
export type CatalogDevice = components["schemas"]["CatalogDevice"];

/** A UTC hour or a plant-local calendar period statistics are cut in (ADR 3, 9). */
export type Period = components["schemas"]["Period"];

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

export { settleRead, type Problem, type Settled } from "./client";

export type { Datasheet, ModuleType } from "./layouts";

// The layout as the core's API carries it (ADR 25).
export type { Layout, PvString, StringDraft } from "@sunreye/scene";

export type { ImportStatus, SharedArchive } from "./imports";

export type {
  Connection,
  ConnectionDraft,
  CreatedToken,
  Found,
  Listing,
  PointDraft,
  Scope,
  Token,
  Viewer,
} from "./setup";

export type { Live, Values } from "./live";

export { PLANT, registered, SPOT, TARIFF, WEATHER } from "./computed-devices";

export type { Corrections } from "./model";

export type { BiddingZone, ScheduleChange, SpotPriceZone, Tariff, TariffChange } from "./tariff";

/**
 * How the SPA reaches a core (ADR 11): plain HTTP to its own core now, the relay's tunnel later.
 * The live stream goes through it too, as a streamed response body.
 */
export interface Transport {
  /** The core's root, ending in `/`; API paths resolve under it, so a prefix carries through. */
  readonly base: string;
  readonly fetch: (request: Request) => Promise<Response>;
}

/** The one answer of a range read of one series. */
export function only<T>(answers: readonly (T | Problem)[]): T | Problem {
  return answers[0] ?? { problem: "request.query" };
}

/** The core that served the page, at `base`. */
export function http(base: string): Transport {
  return { base, fetch: (request) => fetch(request) };
}

/** A core's API: what the SPA reads, through one transport. */
export interface Core extends Setup, Imports, Tariffs, PlantRecords, Layouts, Views, Reference {
  /** Calls `listener` with every value on connect and after each change, until the returned stop. */
  live(listener: (live: Live) => void): () => void;
  /**
   * Time-weighted means of each of `series` from `from` to before `to`, at the tier the core
   * picks; one answer or refusal a series, in order (ADR 9).
   */
  history(
    device: number,
    series: readonly string[],
    from: Date,
    to: Date,
  ): Promise<readonly (History | Problem)[]>;
  /** Each of `series`' figures per plant-local period starting from `from` to before `to`. */
  statistics(
    device: number,
    series: readonly string[],
    period: Period,
    from: Date,
    to: Date,
  ): Promise<readonly (Statistics | Problem)[]>;
  /** Every device with stored history, present or removed, with its stored series, by id. */
  series(): Promise<readonly CatalogDevice[] | Problem>;
  /** The latest forecast of each target of each of `series` from `from` to before `to`. */
  forecasts(
    device: number,
    series: readonly string[],
    from: Date,
    to: Date,
  ): Promise<readonly (Forecasts | Problem)[]>;
  /** Every registered device; admin only. */
  devices(): Promise<readonly Device[] | Problem>;
  /** What the core supports, and each device's settings. */
  capabilities(): Promise<Capabilities | Problem>;
  /** Writes `value` to a device's setting through the core's one funnel; admin only. */
  write(device: number, key: string, value: number): Promise<Attempt | Problem>;
  /** A device's setting's current value, `null` when unknown; admin only, as it reaches the device. */
  read(device: number, key: string): Promise<Readonly<{ value: number | null }> | Problem>;
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

/** The core behind `transport`; its one live stream closes while `page` is hidden (ADR 21). */
export function connect(
  transport: Transport,
  page: Visibility | undefined = globalThis.document,
): Core {
  const client = open(transport.base, transport.fetch);

  return remembering(unremembered(client, transport, page), page, client);
}

/** Every read asks the core. */
function unremembered(client: Client, transport: Transport, page: Visibility | undefined): Core {
  return {
    live: shared(client, page),
    history: (device, series, from, to) =>
      bySeries(series, async (names) => {
        const { data, error, response } = await client.GET("/api/v1/devices/{id}/history", {
          params: { path: { id: device }, query: span(names, from, to) },
        });

        return data ? data.series : refusal(error, response.status);
      }),
    statistics: (device, series, period, from, to) =>
      bySeries(series, async (names) => {
        const { data, error, response } = await client.GET("/api/v1/devices/{id}/statistics", {
          params: { path: { id: device }, query: { ...span(names, from, to), period } },
        });

        return data ? data.series : refusal(error, response.status);
      }),
    forecasts: (device, series, from, to) =>
      bySeries(series, async (names) => {
        const { data, error, response } = await client.GET("/api/v1/devices/{id}/forecasts", {
          params: { path: { id: device }, query: span(names, from, to) },
        });

        return data ? data.series : refusal(error, response.status);
      }),
    ...layouts(client),
    ...settings(client),
    ...trust(client),
    ...setup(client),
    ...imports(client),
    ...status(client),
    ...tariffs(client),
    ...plantRecords(client),
    ...catalog(client),
    ...views(client),
    ...reference(transport),
  };
}

/** The series catalog (ADR 22). */
function catalog(client: Client): Pick<Core, "series"> {
  return {
    series: async () => {
      const { data, error, response } = await client.GET("/api/v1/series");

      return data ? data.devices : refusal(error, response.status);
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
function settings(
  client: Client,
): Pick<Core, "devices" | "capabilities" | "write" | "read" | "writes"> {
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
    read: async (device, key) => {
      const { data, error, response } = await client.GET("/api/v1/devices/{id}/settings/{key}", {
        params: { path: { id: device, key } },
      });

      return data ? { value: data.value ?? null } : refusal(error, response.status);
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

/** Series over a span, as the range routes take them. */
function span(series: readonly string[], from: Readonly<Date>, to: Readonly<Date>) {
  return { series: [...series], from: from.toISOString(), to: to.toISOString() };
}
