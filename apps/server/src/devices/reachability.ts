/**
 * Is the ENDPOINT there? Per KIND — a TCP connect for a Modbus gateway, an MQTT
 * CONNECT for a broker (#217).
 *
 * The connection dialog edits an address, not a device: it has no unit id and
 * no profile of its own to read registers with, and a gateway can carry three
 * devices with three drivers. So its probe asks the one question an address can
 * answer — does something accept a connection on that port — and leaves the
 * register read to the device dialog, which knows what to read and with what.
 */

import {
  type ModbusParams,
  type MqttParams,
  modbusParamsSchema,
  mqttParamsSchema,
} from "@SunReye/db/connection-kinds";
import { errorMessage } from "@SunReye/inverter-core/error-message";
import { z } from "zod";

/** Open a connection and close it, or throw with the reason. Injected so the probe is testable without a socket. */
export type Dial = (host: string, port: number, timeoutMs: number) => Promise<void>;

const probeSchema = z.object({
  host: z.string().trim().min(1, "host is required"),
  port: z.number().int().min(1).max(65535),
  timeoutMs: z.number().int().min(100).max(60_000).default(2000),
});

/**
 * What a probe answers with.
 *
 * `logger` is on the success arm only, and optional there: a plain TCP connect
 * learns nothing about what answered, and only a Solarman handshake does. It is
 * NESTED rather than a flat `serial` because a probe may one day learn other
 * things about what answered — a firmware string, a model — and a flat field
 * would have to be renamed the day it does. The web app reads exactly this
 * shape (`connectionProbeAnswer`).
 */
export type ProbeResult =
  | { ok: true; ms: number; logger?: { serial: number } }
  | { ok: false; ms: number; error: string };

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
      // Disarmed on the way out. Left armed, it held a handle for a second
      // past the client's own `connectTimeout` — which always settles first, so
      // it could never legitimately fire — and then called `end` on a client
      // that had already ended.
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const done = (error?: Error) => {
        if (watchdog !== undefined) clearTimeout(watchdog);
        client.end(true, () => {});
        if (error) reject(error);
        else resolve();
      };
      client.once("connect", () => done());
      client.once("error", (error) => done(error));
      watchdog = setTimeout(() => done(new Error("connection timed out")), PROBE_TIMEOUT_MS + 1000);
    });
  });

const PROBE_TIMEOUT_MS = 4000;

/**
 * Dial a SOLARMAN LOGGING STICK: complete the V5 handshake and answer the serial
 * the stick named ITSELF with, or throw with the reason.
 *
 * Its own seam beside {@link Dial} for the same reason {@link BrokerDial} is:
 * the question is a different one. A stick accepts a TCP connection the moment
 * it is powered — the Solarman cloud's own client is what it expects there — so
 * a bare connect answers "reachable" for a plain Modbus-TCP gateway squatting on
 * 8899, for a stick whose firmware speaks nothing we can frame, and for the
 * OTHER stick on a two-inverter site. The V5 handshake answers all three,
 * because every reply a stick sends carries its own serial in the header — a
 * reject names it just as well as a real response does.
 */
export type SolarmanDial = (params: ModbusParams) => Promise<number>;

/**
 * Restate the one failure whose stock wording is wrong HERE.
 *
 * `SolarmanV5Port` fails an unanswered discovery probe by telling the reader to
 * configure the serial off the sticker inside the dongle — the right advice for
 * a poll loop whose endpoint is already configured, and the wrong advice for an
 * operator standing in the connection dialog having just pointed it somewhere:
 * what they need to know is that the thing at that address did not speak V5, not
 * that they should go find a screwdriver. Every other reason (refused, timed
 * out, reset, closed early) is the system's own and is passed through untouched
 * — a probe that paraphrases errno helps nobody.
 */
// fallow-ignore-next-line unused-export -- the wording the operator reads, held to it by reachability.test.ts; test files aren't traced as consumers, and the only other way to reach it is a real socket
export function solarmanProbeFailure(at: { host: string; port: number }, error: unknown): Error {
  const message = errorMessage(error);
  if (!message.includes("did not answer the discovery probe")) return new Error(message);
  return new Error(
    `${at.host}:${at.port} accepted the connection but did not answer a Solarman V5 frame — ` +
      `nothing there speaks V5 (a plain Modbus-TCP gateway does not)`,
  );
}

/**
 * The production solarman dial: open a V5 port, take what it discovered, close.
 *
 * NO configured serial is handed to the port, deliberately. The port treats one
 * as a fallback for a probe that went unanswered, and a probe that falls back is
 * a probe that reports the operator's own typed number back at them as if a
 * stick had said it — the most convincing possible way to confirm a wrong guess.
 */
const solarmanV5Dial: SolarmanDial = async (params) => {
  // Imported lazily so this module stays loadable without `modbus-serial`.
  const { SolarmanV5Port } = await import("@SunReye/inverter-core");
  const port = new SolarmanV5Port({
    host: params.host,
    port: params.port,
    timeoutMs: params.timeoutMs,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      port.open((err) => (err ? reject(err) : resolve()));
    });
  } catch (error) {
    throw solarmanProbeFailure(params, error);
  } finally {
    // Always: the stick accepts exactly ONE TCP client, so a probe that leaks a
    // socket locks the poll loop out of the endpoint it just verified.
    port.destroy();
  }
  const serial = port.loggerSerial;
  if (serial === undefined) {
    throw new Error(`${params.host}:${params.port} opened without naming a logger serial`);
  }
  return serial;
};

/**
 * The probe body, PER KIND.
 *
 * `params` is partial-tolerant on the way in and validated by the kind's own
 * arm, so the two shapes cannot be confused: a `modbus` body carrying a
 * `brokerUrl` is refused rather than dialled at port 502.
 *
 * THE LEGACY ARM IS DELIBERATE. A bare `{ host, port }` with no `kind` still
 * means a Modbus probe, so a client older than the kind column — a stale tab, a
 * script, the pre-#217 dialog — is dialled rather than answered 400.
 */
const probeBodySchema = z.union([
  z.object({ kind: z.literal("modbus"), params: modbusParamsSchema }),
  z.object({ kind: z.literal("mqtt"), params: mqttParamsSchema }),
  // Widened to the FULL modbus params rather than left at the three fields it
  // carries, so the arms below are one shape: the framing decides which dial
  // runs now, and a body with no `kind` has no framing to state. It lands on
  // `tcp`, which is what every pre-#217 client meant by a probe.
  probeSchema.transform((params) => ({
    kind: "modbus" as const,
    params: modbusParamsSchema.parse(params),
  })),
]);

/** The two dials, injected so every branch is testable without a socket. */
export interface ProbeDials {
  tcp: Dial;
  broker: BrokerDial;
  solarman: SolarmanDial;
}

/**
 * Validate a connection body, dial it the way its KIND is dialled, and say how
 * it went and how long it took. Throws on a bad body.
 */
export async function probeConnection(
  body: unknown,
  dials: ProbeDials = { tcp: tcpDial, broker: mqttDial, solarman: solarmanV5Dial },
): Promise<ProbeResult> {
  const probe = probeBodySchema.parse(body);
  const started = performance.now();
  try {
    if (probe.kind === "modbus" && probe.params.transport === "solarman-v5") {
      const serial = await dials.solarman(probe.params);
      const configured = probe.params.loggerSerial;
      // A MISMATCH IS A FAILURE, not a warning. The operator types the serial
      // off the sticker of the stick they mean; ignoring a disagreement is how a
      // two-inverter site ends up polling the wrong half of itself, with every
      // reading plausible and every one of them the other inverter's.
      if (configured !== undefined && configured !== serial) {
        throw new Error(
          `${probe.params.host}:${probe.params.port} is logger ${serial}, not the ${configured} ` +
            `configured here — this is a different stick`,
        );
      }
      return { ok: true, ms: Math.round(performance.now() - started), logger: { serial } };
    }
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
      error: errorMessage(error),
    };
  }
}
