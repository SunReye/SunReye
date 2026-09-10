/**
 * THE CONNECTION DIALOG'S DRAFT — one form state that can be either kind, and
 * the rules that turn it into a request.
 *
 * A connection used to be "a Modbus endpoint": host, port, transport, timeout,
 * cadence, as five flat fields. Since #217 the row carries a `kind` and a
 * `params` document, and the two arms share NOT ONE field — so a flat draft
 * with everything optional would let the dialog send a `brokerUrl` to port 502.
 *
 * The draft therefore holds BOTH halves at once and a `kind` that says which
 * one counts. Switching the kind in the dialog does not discard what was typed
 * in the other half, which matters on a phone in a cellar: a mis-click on a
 * three-option select must not empty five fields.
 *
 * WHY AN EDIT NEVER SPELLS A `kind`
 *
 * `PATCH /api/connections/:id` answers 409 with `field: "kind"` for a kind that
 * differs from the row's, because every device bound to the connection was
 * provisioned for its tier — a Modbus slave id, an EVCC loadpoint index — and
 * re-kinding the row in place would leave them addressed for a bus that no
 * longer exists. The row's own kind is the only value the dialog could
 * truthfully send, so {@link connectionPatchBody} sends none and the server
 * parses `params` against the kind it already has.
 */

import type { ConnectionKind, ConnectionView, ModbusParams } from "./device-types";

/** The Modbus half of the draft — the five endpoint fields, as the form holds them. */
export type ModbusDraft = ModbusParams;

/**
 * The broker half. Every field is a string the input owns, `password` included:
 * the API never returns one, so an empty box means "leave the stored one alone"
 * and {@link ConnectionDraft.hasPassword} is what the placeholder reads.
 */
export type MqttDraft = {
  brokerUrl: string;
  username: string;
  password: string;
  clientId: string;
};

export type ConnectionDraft = {
  name: string;
  kind: ConnectionKind;
  /** Whether the row being edited already stores a broker password. */
  hasPassword: boolean;
  modbus: ModbusDraft;
  mqtt: MqttDraft;
};

/** The defaults the dropped Modbus columns carried, to the millisecond. */
const MODBUS_DEFAULTS: ModbusDraft = {
  host: "",
  port: 502,
  transport: "tcp",
  timeoutMs: 2000,
  pollIntervalMs: 1000,
};

const MQTT_DEFAULTS: MqttDraft = { brokerUrl: "", username: "", password: "", clientId: "" };

/** An empty draft, on the kind the dialog opens on. */
export function blankDraft(name = "", kind: ConnectionKind = "modbus"): ConnectionDraft {
  return {
    name,
    kind,
    hasPassword: false,
    modbus: { ...MODBUS_DEFAULTS },
    mqtt: { ...MQTT_DEFAULTS },
  };
}

/** The draft that edits an existing row: its kind, its params, and no password. */
export function draftFromConnection(connection: ConnectionView): ConnectionDraft {
  const draft = blankDraft(connection.name, connection.kind);
  if (connection.kind === "modbus") {
    draft.modbus = { ...connection.params };
    return draft;
  }
  draft.hasPassword = connection.params.hasPassword;
  draft.mqtt = {
    brokerUrl: connection.params.brokerUrl,
    username: connection.params.username ?? "",
    password: "",
    clientId: connection.params.clientId ?? "",
  };
  return draft;
}

/** The broker params on the wire. Absent, not empty: `clientId` is `min(1)` server-side. */
export type MqttParamsBody = {
  brokerUrl: string;
  username?: string;
  password?: string;
  clientId?: string;
};

/** `{ kind, params }` — what the probe takes, and the tail of a create body. */
export type ConnectionParamsBody =
  | { kind: "modbus"; params: ModbusParams }
  | { kind: "mqtt"; params: MqttParamsBody };

/** What `POST /api/devices`'s `connection.create` arm, and the add dialog, take. */
export type ConnectionCreate = { name: string } & ConnectionParamsBody;

/** An optional string field: the trimmed value, or absent when it is blank. */
function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Drop the keys whose value is `undefined`, so the body is exactly what was typed. */
function defined<T extends object>(params: T): T {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)) as T;
}

/**
 * The draft's params for its own kind, or null while the one field that has no
 * default is still blank — a Modbus endpoint with no host, a broker with no URL.
 *
 * Null rather than a list of problems: each field shows its own hint, and this
 * one answer is what the save button binds its `disabled` to. THE ARM NOT
 * CHOSEN IS NEVER READ, so an empty Modbus half cannot block a broker.
 */
export function connectionParamsOf(draft: ConnectionDraft): ConnectionParamsBody | null {
  if (draft.kind === "modbus") {
    const host = draft.modbus.host.trim();
    return host === "" ? null : { kind: "modbus", params: { ...draft.modbus, host } };
  }
  const brokerUrl = draft.mqtt.brokerUrl.trim();
  if (brokerUrl === "") return null;
  return {
    kind: "mqtt",
    params: defined({
      brokerUrl,
      username: optional(draft.mqtt.username),
      password: optional(draft.mqtt.password),
      clientId: optional(draft.mqtt.clientId),
    }),
  };
}

/** The create body, or null while the draft is not sendable. */
export function connectionCreateBody(draft: ConnectionDraft): ConnectionCreate | null {
  const name = draft.name.trim();
  if (name === "") return null;
  const params = connectionParamsOf(draft);
  return params === null ? null : { name, ...params };
}

/**
 * The patch body: the name and the params, and deliberately NO kind (see the
 * header). An untouched broker edit carries no password, which is how the
 * stored credential survives a rename.
 */
export function connectionPatchBody(
  draft: ConnectionDraft,
): { name: string; params: ModbusParams | MqttParamsBody } | null {
  const body = connectionCreateBody(draft);
  return body === null ? null : { name: body.name, params: body.params };
}

/**
 * The host a broker URL names, for a label — scheme, port and path dropped.
 *
 * Tolerant on purpose: what an operator types is `mqtt://host:1883`, but a bare
 * `host` and a bare `host:1883` are both things they type too, and a label is
 * not the place to refuse one. Anything `URL` cannot read falls back to the
 * text before the first colon, and to the raw string when even that is empty.
 */
export function brokerHost(url: string): string {
  const raw = url.trim();
  if (raw === "") return "";
  const withScheme = raw.includes("://") ? raw : `mqtt://${raw}`;
  try {
    const host = new URL(withScheme).hostname;
    if (host !== "") return host;
  } catch {
    // Not a URL at all — fall through to the textual guess.
  }
  return raw.split("://").at(-1)?.split(/[:/]/)[0] || raw;
}

/** The address under a connection's name, per kind: `host:port`, or the broker's host. */
export function connectionAddress(connection: ConnectionView): string {
  if (connection.kind === "mqtt") return brokerHost(connection.params.brokerUrl);
  const { host, port } = connection.params;
  return host === "" ? "" : `${host}:${port}`;
}
