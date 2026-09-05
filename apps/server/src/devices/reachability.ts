/**
 * Is the gateway THERE? A TCP connect to host:port, nothing more.
 *
 * The connection dialog edits an address, not a device: it has no unit id and
 * no profile of its own to read registers with, and a gateway can carry three
 * devices with three drivers. So its probe asks the one question an address can
 * answer — does something accept a connection on that port — and leaves the
 * register read to the device dialog, which knows what to read and with what.
 */

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
