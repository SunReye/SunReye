/**
 * The HTTP {@link DeviceTransport}: one GET per poll, values picked out of the
 * JSON body by RFC 6901 pointer.
 *
 * Almost nothing lives here, and that is the finding. A register bus needs block
 * coalescing, a per-request cap, atomic groups and a split-and-remember fallback;
 * an HTTP GET is atomic for free, so this file is a request, a pointer walk, and
 * the shared scaling tail every transport uses. Everything it does not do —
 * derive computed metrics, stamp the sample, decide the poll cadence — is above
 * the seam and unchanged.
 */

import { getLogger } from "@logtape/logtape";

import { applyScaling } from "./codec";
import type {
  DeviceTransport,
  HttpConnection,
  InverterProfile,
  MetricDef,
  MetricValues,
} from "./types";

const log = getLogger(["inverter-core", "http"]);

/** Default request deadline: long enough for a busy device, short enough to poll. */
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Why a poll failed. A device that is unreachable, one that answers 404 and one
 * that answers an HTML login page are three different faults with three
 * different fixes, so they are three different kinds rather than one message.
 */
export type HttpFailureKind =
  /** The device answered, with a non-2xx status. */
  | "status"
  /** The device did not answer inside the deadline. */
  | "timeout"
  /** The request never reached a device: DNS, refused, reset, offline. */
  | "network"
  /** The device answered something that is not a JSON object. */
  | "malformed";

/** A poll that failed, tagged with which of the four ways it failed. */
export class HttpReadError extends Error {
  readonly kind: HttpFailureKind;
  /** The HTTP status, for `kind: "status"` only. */
  readonly status?: number;

  constructor(kind: HttpFailureKind, message: string, opts?: { status?: number; cause?: unknown }) {
    super(message, opts?.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "HttpReadError";
    this.kind = kind;
    this.status = opts?.status;
  }
}

/**
 * One RFC 6901 reference token, unescaped: `~1` is a literal `/` and `~0` a
 * literal `~`. Order matters — unescaping `~0` first would turn `~01` into `~1`
 * and then into `/`.
 */
function unescapeToken(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

/** An array index per RFC 6901: digits, no leading zero (except `0` itself). */
function arrayIndex(token: string): number | undefined {
  if (!/^(?:0|[1-9][0-9]*)$/.test(token)) return undefined;
  return Number(token);
}

/**
 * Walk a JSON pointer into a parsed body. Returns `undefined` for anything that
 * is not a number at the end of it: a token that does not resolve, a `null` (a
 * device saying it does not know — Shelly reports an unsynced clock that way), a
 * string, an object, or a non-finite number.
 *
 * An absent value must never become 0. Zero is a legitimate reading for grid
 * power (a balanced house) and for an export counter, so a fabricated zero is
 * indistinguishable from the real thing and would steer the automation engines —
 * the same rule the register codec states, for the same reason.
 */
/**
 * One step of the walk: index an array, or take a key out of an object. Own
 * properties only — `JSON.parse` never produces an inherited one, so a pointer
 * that resolves through the prototype chain is reading something the device
 * never sent.
 */
function step(node: unknown, key: string): unknown {
  if (Array.isArray(node)) {
    const i = arrayIndex(key);
    return i === undefined ? undefined : node[i];
  }
  if (typeof node !== "object" || node === null) return undefined;
  return Object.hasOwn(node, key) ? (node as Record<string, unknown>)[key] : undefined;
}

export function resolvePointer(body: unknown, pointer: string): number | undefined {
  let node: unknown = body;
  // A pointer always starts with `/`, so the first split part is the empty
  // string before it and is not a token.
  for (const token of pointer.split("/").slice(1)) {
    node = step(node, unescapeToken(token));
  }
  return typeof node === "number" && Number.isFinite(node) ? node : undefined;
}

/** HTTP transport for a device whose whole state is one JSON document. */
export class HttpTransport implements DeviceTransport {
  readonly kind = "http";
  /**
   * Read-only. A GET has no write counterpart, and the devices this arm exists
   * for expose writes as named RPC methods, which `write(key, value)` cannot
   * express — better refused up front than half-supported.
   */
  readonly caps = { canWrite: false, pushBased: false };

  private readonly profile: InverterProfile;
  private readonly conn: HttpConnection;
  private readonly fetch: typeof globalThis.fetch;

  constructor(
    profile: InverterProfile,
    conn: HttpConnection,
    opts: { fetch?: typeof globalThis.fetch } = {},
  ) {
    this.profile = profile;
    this.conn = conn;
    // Injected rather than reached for globally, so a test never has to mutate
    // `globalThis` and leak the stub into every file that runs after it.
    this.fetch = opts.fetch ?? globalThis.fetch;
  }

  /** Nothing to open: each poll's GET carries its own connection. */
  async connect(): Promise<void> {}

  /** Nothing to close, for the same reason. */
  async close(): Promise<void> {}

  /**
   * One GET, then every http-bound metric read out of the body it answered.
   *
   * No `readAt` and no `degraded`: a single response is a single device-side
   * snapshot, so the sample's own time is the honest one for every value in it —
   * the atomicity Modbus has to plan for, for free.
   */
  async read(): Promise<{ values: MetricValues }> {
    const started = performance.now();
    const body = await this.fetchBody();

    const values: MetricValues = {};
    for (const def of this.profile.metrics) {
      if (def.binding.via !== "http") continue;
      const raw = resolvePointer(body, def.binding.pointer);
      const value = raw === undefined ? undefined : applyScaling(def, raw);
      if (value !== undefined) values[def.key] = value;
    }
    log.debug("read {metrics} metrics from {url} ({ms} ms)", {
      metrics: Object.keys(values).length,
      url: this.conn.url,
      ms: Math.round(performance.now() - started),
    });
    return { values };
  }

  /** The parsed JSON object the device answered, or a tagged failure. */
  private async fetchBody(): Promise<Record<string, unknown>> {
    const response = await this.request();
    if (!response.ok) {
      throw new HttpReadError("status", `${this.conn.url} answered ${response.status}`, {
        status: response.status,
      });
    }
    const body = await response.json().catch((cause: unknown) => {
      throw new HttpReadError("malformed", `${this.conn.url} answered unparseable JSON`, { cause });
    });
    // An array or a bare number means the endpoint is wrong. Reporting that is
    // the point; letting every metric read absent would look like a dead device.
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new HttpReadError("malformed", `${this.conn.url} answered a non-object JSON body`);
    }
    return body as Record<string, unknown>;
  }

  /** The GET itself, with a deadline, mapping transport faults onto kinds. */
  private async request(): Promise<Response> {
    try {
      return await this.fetch(this.conn.url, {
        signal: AbortSignal.timeout(this.conn.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        headers: this.conn.headers,
      });
    } catch (cause) {
      // An abort past the deadline and an unreachable host both surface as a
      // thrown fetch; only the first is the device being slow.
      const timedOut = cause instanceof Error && cause.name === "TimeoutError";
      throw timedOut
        ? new HttpReadError("timeout", `${this.conn.url} did not answer in time`, { cause })
        : new HttpReadError("network", `${this.conn.url} is unreachable`, { cause });
    }
  }

  /**
   * Always refuses, before any request. `caps.canWrite` says so too, but a
   * caller that ignored it must not discover the truth from a device that
   * silently did nothing.
   */
  async write(key: string, _value: number): Promise<void> {
    const known = this.profile.metrics.some((m: MetricDef) => m.key === key);
    throw new Error(
      known
        ? `${this.kind} transport cannot write: ${key}`
        : `unknown metric: ${key} (and the ${this.kind} transport cannot write in any case)`,
    );
  }
}
