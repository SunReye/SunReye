/**
 * Is the gateway THERE? A TCP connect to host:port, nothing more.
 *
 * The connection dialog edits an address, not a device: it has no unit id and
 * no profile of its own to read registers with, and a gateway can carry three
 * devices with three drivers. So its probe asks the one question an address can
 * answer — does something accept a connection on that port — and leaves the
 * register read to the device dialog, which knows what to read and with what.
 */

import {
  type MqttParams,
  modbusParamsSchema,
  mqttParamsSchema,
} from "@SunReye/db/connection-kinds";
import { z } from "zod";

/** Open a connection and close it, or throw with the reason. Injected so the probe is testable without a socket. */
export type Dial = (host: string, port: number, timeoutMs: number) => Promise<void>;

const probeSchema = z.object({
  host: z.string().trim().min(1, "host is required"),
  port: z.number().int().min(1).max(65535),
  timeoutMs: z.number().int().min(100).max(60_000).default(2000),
});

export type ProbeResult = { ok: true; ms: number } | { ok: false; ms: number; error: string };

/** The production dial: `node:net`, resolved on connect, rejected on error or timeout. */
const tcpDial: Dial = (host, port, timeoutMs) =>
  new Promise<void>((resolve, reject) => {
    // Imported lazily so this module stays loadable in a browser-free test.
    void import("node:net").then(({ createConnection }) => {
      const socket = createConnection({ host, port });
      const done = (error?: Error) => {
        socket.destroy();
        if (error) reject(error);
        else resolve();
      };
      socket.setTimeout(timeoutMs, () => done(new Error(`timed out after ${timeoutMs} ms`)));
      socket.once("connect", () => done());
      socket.once("error", (error) => done(error));
    });
  });

/** Validate, dial once, and say how it went and how long it took. Throws on a bad body. */
export async function probeEndpoint(body: unknown, dial: Dial = tcpDial): Promise<ProbeResult> {
  const { host, port, timeoutMs } = probeSchema.parse(body);
  const started = performance.now();
  try {
    await dial(host, port, timeoutMs);
    return { ok: true, ms: Math.round(performance.now() - started) };
  } catch (error) {
    return {
      ok: false,
      ms: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Dial a BROKER: connect, and close again, or throw with the reason.
 *
 * Its own seam beside {@link Dial} because the question is a different one. A
 * TCP connect to a broker's port succeeds for every broker that is running,
 * credentials wrong or not — so probing one that way reports "reachable" for the
 * exact misconfiguration the operator opened the dialog to find.
 */
export type BrokerDial = (params: MqttParams) => Promise<void>;

/** The production broker dial: one-shot MQTT CONNECT, no retry loop. */
const mqttDial: BrokerDial = (params) =>
  new Promise<void>((resolve, reject) => {
    // Imported lazily so this module stays loadable in a broker-free test.
    void import("mqtt").then(({ default: mqtt }) => {
      const client = mqtt.connect(params.brokerUrl, {
        username: params.username,
        password: params.password,
        ...(params.clientId ? { clientId: params.clientId } : {}),
        connectTimeout: PROBE_TIMEOUT_MS,
        // One shot: a bad broker must answer the operator, not be retried
        // forever behind an HTTP request that has already timed out.
        reconnectPeriod: 0,
      });
      const done = (error?: Error) => {
        client.end(true, () => {});
        if (error) reject(error);
        else resolve();
      };
      client.once("connect", () => done());
      client.once("error", (error) => done(error));
      setTimeout(() => done(new Error("connection timed out")), PROBE_TIMEOUT_MS + 1000);
    });
  });

const PROBE_TIMEOUT_MS = 4000;

/**
 * The probe body, PER KIND.
 *
 * `params` is partial-tolerant on the way in and validated by the kind's own
 * arm, so the two shapes cannot be confused: a `modbus` body carrying a
 * `brokerUrl` is refused rather than dialled at port 502.
 *
 * THE LEGACY ARM IS DELIBERATE. The add-connection dialog is the web half of
 * #217 and ships separately, so a bare `{ host, port }` — what the current
 * dialog sends — still means a Modbus probe. Dropping it would 400 the live
 * dialog the moment this lands.
 */
const probeBodySchema = z.union([
  z.object({ kind: z.literal("modbus"), params: modbusParamsSchema }),
  z.object({ kind: z.literal("mqtt"), params: mqttParamsSchema }),
  probeSchema.transform((params) => ({ kind: "modbus" as const, params })),
]);

/** The two dials, injected so every branch is testable without a socket. */
export interface ProbeDials {
  tcp: Dial;
  broker: BrokerDial;
}

/**
 * Validate a connection body, dial it the way its KIND is dialled, and say how
 * it went and how long it took. Throws on a bad body.
 */
export async function probeConnection(
  body: unknown,
  dials: ProbeDials = { tcp: tcpDial, broker: mqttDial },
): Promise<ProbeResult> {
  const probe = probeBodySchema.parse(body);
  const started = performance.now();
  try {
    if (probe.kind === "modbus") {
      await dials.tcp(probe.params.host, probe.params.port, probe.params.timeoutMs);
    } else {
      await dials.broker(probe.params);
    }
    return { ok: true, ms: Math.round(performance.now() - started) };
  } catch (error) {
    return {
      ok: false,
      ms: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
