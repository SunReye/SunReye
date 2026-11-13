// What the first run configures (ADR 9, 11): the admin password, sign-in, the plant timezone and
// location, devices and the topology; and who else signs in afterwards.
import { access, type Access } from "./access";
import { done, refusal, type Client, type Problem } from "./client";
import type { Device } from "./core";
import type { components } from "./schema";

export type Location = components["schemas"]["Location"];

/** A timezone by IANA name. */
export type Zone = components["schemas"]["Zone"];

/** What the setup scan found: each endpoint with the devices proposed behind it (ADR 6). */
export type ScanReport = components["schemas"]["ScanReport"];

export type Found = components["schemas"]["Found"];

/** A connection without credentials, as the scan finds one; readonly to its publisher. */
export type Reach = Readonly<
  Omit<components["schemas"]["Reach"], "publish"> & {
    publish?: Readonly<components["schemas"]["Publish"]> | null;
  }
>;

export type Connection = components["schemas"]["Connection"];

export type DeviceDraft = components["schemas"]["DeviceDraft"];

export type Claim = Readonly<components["schemas"]["Claim"]>;

/** A point as the admin enters it, naming its parent by index. */
export type PointDraft = Readonly<Omit<components["schemas"]["PointDraft"], "claims">> & {
  readonly claims: readonly Claim[];
};

/** A topology change: points in order, the root first, each naming its parent by index (ADR 14). */
export interface TopologyChange {
  /** RFC 3339. */
  readonly appliesFrom: string;
  readonly points: readonly PointDraft[];
}

export type Topology = components["schemas"]["Topology"];

export type { CreatedToken, Scope, Token, Viewer } from "./access";

export interface Setup extends Access {
  /** Undefined while signed in, Home Assistant's ingress too; else `auth.setup` or `auth.required`. */
  session(): Promise<Problem | undefined>;
  /** Sets the admin password on the first run. */
  setPassword(password: string): Promise<Problem | undefined>;
  /** Signs the admin in, or a viewer by `name`. */
  signIn(password: string, name?: string): Promise<Problem | undefined>;
  /** The plant timezone, which days are cut in (ADR 3). */
  timezone(): Promise<Zone | Problem>;
  /** Sets the plant timezone by IANA name; admin only. */
  setTimezone(name: string): Promise<Problem | undefined>;
  /** Sets the plant's location; admin only. */
  setLocation(location: Readonly<Location>): Promise<Location | Problem>;
  /** Scans the local network, or `subnet`, for devices; admin only. */
  scan(subnet?: string): Promise<ScanReport | Problem>;
  /** Adds a connection; admin only. */
  addConnection(reach: Reach): Promise<Connection | Problem>;
  /** Adds a device behind a connection; admin only. */
  addDevice(draft: Readonly<DeviceDraft>): Promise<Device | Problem>;
  /** Changes a device, such as its writes switch (ADR 7); admin only. */
  changeDevice(id: number, draft: Readonly<DeviceDraft>): Promise<Device | Problem>;
  /** The topology in force now; a viewer reads it too. */
  topology(): Promise<Topology | Problem>;
  /** Changes the topology from an instant on; admin only. */
  changeTopology(change: TopologyChange): Promise<Topology | Problem>;
}

export function setup(client: Client): Setup {
  return {
    session: async () => {
      const { error, response } = await client.GET("/api/v1/session");

      return done(error, response);
    },
    setPassword: async (password) => {
      const { error, response } = await client.POST("/api/v1/setup", { body: { password } });

      return done(error, response);
    },
    signIn: async (password, name) => {
      const { error, response } = await client.POST("/api/v1/login", {
        body: name === undefined ? { password } : { name, password },
      });

      return done(error, response);
    },
    ...zone(client),
    ...plant(client),
    ...topology(client),
    ...devices(client),
    ...access(client),
  };
}

/** The plant timezone. */
function zone(client: Client): Pick<Setup, "timezone" | "setTimezone"> {
  return {
    timezone: async () => {
      const { data, error, response } = await client.GET("/api/v1/timezone");

      return data ?? refusal(error, response.status);
    },
    setTimezone: async (name) => {
      const { error, response } = await client.PUT("/api/v1/timezone", { body: { name } });

      return done(error, response);
    },
  };
}

/** The devices behind the connections. */
function devices(client: Client): Pick<Setup, "addDevice" | "changeDevice"> {
  return {
    addDevice: async (draft) => {
      const { data, error, response } = await client.POST("/api/v1/devices", { body: draft });

      return data ?? refusal(error, response.status);
    },
    changeDevice: async (id, draft) => {
      const { data, error, response } = await client.PUT("/api/v1/devices/{id}", {
        params: { path: { id } },
        body: draft,
      });

      return data ?? refusal(error, response.status);
    },
  };
}

/** The plant's measurement points (ADR 14). */
function topology(client: Client): Pick<Setup, "topology" | "changeTopology"> {
  return {
    topology: async () => {
      const { data, error, response } = await client.GET("/api/v1/topology");

      return data ?? refusal(error, response.status);
    },
    changeTopology: async ({ appliesFrom, points }) => {
      const { data, error, response } = await client.PUT("/api/v1/topology", {
        body: {
          appliesFrom,
          points: points.map(({ id, name, parent, claims }) => ({
            id: id ?? null,
            name,
            parent: parent ?? null,
            claims: [...claims],
          })),
        },
      });

      return data ?? refusal(error, response.status);
    },
  };
}

/** The plant's configuration. */
function plant(
  client: Client,
): Omit<
  Setup,
  | keyof Access
  | "session"
  | "setPassword"
  | "signIn"
  | "timezone"
  | "setTimezone"
  | "addDevice"
  | "changeDevice"
  | "topology"
  | "changeTopology"
> {
  return {
    setLocation: async (location) => {
      const { data, error, response } = await client.PUT("/api/v1/location", { body: location });

      return data ?? refusal(error, response.status);
    },
    scan: async (subnet) => {
      const { data, error, response } = await client.POST("/api/v1/scan", {
        body: subnet === undefined ? {} : { subnet },
      });

      return data ?? refusal(error, response.status);
    },
    addConnection: async (reach) => {
      const { data, error, response } = await client.POST("/api/v1/connections", { body: reach });

      return data ?? refusal(error, response.status);
    },
  };
}
