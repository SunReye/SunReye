/**
 * The two halves, connected: a real {@link ModbusTransport} talking real TCP to
 * a stand-in Solarman logger that refuses an out-of-map read the way the
 * captured stick does — with a V5 `05 00` reject and no Modbus exception
 * anywhere on the wire.
 *
 * This is the test that makes the translation in `v5-port.ts` worth anything.
 * Everything below it can pass while the feature is useless: the port can
 * synthesize a perfectly-formed `01 83 02` that modbus-serial then discards for
 * a CRC it disagrees with, or `ModbusTransport` can sniff a `modbusCode` that
 * never arrives. Only an end-to-end run proves the reject actually reaches
 * `isIllegalDataAddress` and actually drives the split-and-remember fallback.
 *
 * A loopback socket rather than an injected double on purpose — `dial()`
 * constructs the port itself, and that construction (the framing switch, the
 * discovery probe, the `new ModbusRTU(port)` wiring) is part of what is under
 * test here.
 */

import { afterEach, describe, expect, test } from "bun:test";
import net from "node:net";

import { ModbusTransport } from "../modbus-transport";
import type { InverterConnection, InverterProfile, MetricDef } from "../types";
import { crc16 } from "./rtu";
import { splitFrames } from "./v5-frame";

/** The captured stick's serial, so the log lines read like the real ones. */
const SERIAL = 0xbce20a25;

/** The register the stand-in inverter will not serve, inside the atomic span. */
const HOLE = 105;

const raw = (key: string, addr: number): MetricDef =>
  ({
    key,
    topic: key,
    label: key,
    unit: null,
    group: "test",
    binding: { via: "modbus", addr: [addr], type: "U_WORD" },
    type: "U_WORD",
    addresses: [addr],
    scale: 1,
    access: "r",
  }) as MetricDef;

const derived = (key: string, computeInputs: string[]): MetricDef =>
  ({
    key,
    topic: key,
    label: key,
    unit: null,
    group: "test",
    binding: { via: "compute", expr: { sum: computeInputs } },
    type: "U_WORD",
    addresses: [],
    scale: 1,
    access: "r",
    compute: () => 0,
    computeInputs,
  }) as MetricDef;

/**
 * Two raw registers 11 apart with a computed metric over both: the planner emits
 * one spanning atomic block 100+11, which necessarily covers {@link HOLE}.
 */
const profile: InverterProfile = {
  id: "solarman-fallback-test",
  name: "Solarman Fallback Test",
  manufacturer: "Test",
  metrics: [raw("a", 100), raw("b", 110), derived("x", ["a", "b"])],
};

const appendCrc = (body: number[]): number[] => {
  const crc = crc16(Uint8Array.from(body));
  return [...body, crc & 0xff, (crc >> 8) & 0xff];
};

/** Wrap a payload in a V5 reply envelope: 14-byte business field, then payload. */
const v5Reply = (seq: number, payload: number[]): Buffer => {
  const payloadLength = 14 + payload.length;
  const frame = new Uint8Array(11 + payloadLength + 2);
  const view = new DataView(frame.buffer);
  frame[0] = 0xa5;
  view.setUint16(1, payloadLength, true);
  view.setUint16(3, 0x1510, true);
  // Low byte echoes the request; the high byte is the logger's own counter.
  view.setUint16(5, (0x0d << 8) | (seq & 0xff), true);
  view.setUint32(7, SERIAL >>> 0, true);
  frame[11] = 0x02;
  frame[12] = 0x01;
  frame.set(Uint8Array.from(payload), 11 + 14);
  frame[frame.length - 1] = 0x15;
  let sum = 0;
  for (let i = 1; i <= frame.length - 3; i++) sum += frame[i]!;
  frame[frame.length - 2] = sum & 0xff;
  return Buffer.from(frame);
};

interface Ask {
  start: number;
  count: number;
}

/**
 * A stand-in for the logging stick, faithful to the captures in the one way that
 * matters: it NEVER sends a Modbus exception. A request it dislikes comes back
 * as `05 00`, exactly as the real stick answered address 60000, address 9000 and
 * a 200-register read.
 */
class FakeLogger {
  readonly reads: Ask[] = [];
  readonly rejected: Ask[] = [];
  /**
   * Refuse a span this many times and then serve it — the TRANSIENT refusal the
   * real stick produces when its own RS485 round trip to the inverter times out
   * under load, which is a different thing from an address it will never serve.
   */
  transientRejects = 0;
  /**
   * The register this inverter will never serve. Set to `undefined` for a device
   * whose whole map is readable, so a transient refusal can be studied without a
   * structural one underneath it.
   */
  hole: number | undefined = HOLE;
  readonly server = net.createServer();
  /** Every client socket still attached, so a test can reset one from the peer side. */
  readonly clients: net.Socket[] = [];
  #buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  async listen(): Promise<number> {
    this.server.on("connection", (socket) => {
      this.clients.push(socket);
      socket.on("data", (chunk: Buffer) => this.#onData(socket, chunk));
      // The stick hangs up freely; a test models that explicitly with
      // `resetClients()`, but an error must never take the test process down.
      socket.on("error", () => {});
    });
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    return (this.server.address() as net.AddressInfo).port;
  }

  /**
   * Hang up the way a loaded stick does: an RST rather than a FIN, which
   * surfaces on the client as `read ECONNRESET` on an already-open socket.
   */
  resetClients(): void {
    for (const socket of this.clients.splice(0)) socket.resetAndDestroy();
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  #onData(socket: net.Socket, chunk: Buffer): void {
    const merged = new Uint8Array(this.#buffer.length + chunk.length);
    merged.set(this.#buffer, 0);
    merged.set(chunk, this.#buffer.length);
    const { frames, rest } = splitFrames(merged);
    this.#buffer = rest;
    for (const frame of frames) socket.write(this.#answer(frame));
  }

  #answer(frame: Uint8Array): Buffer {
    const seq = frame[5]!;
    const serial = new DataView(frame.buffer, frame.byteOffset).getUint32(7, true);
    // The discovery probe asks with serial 0; the stick rejects it at the dongle
    // and names itself in the header it replies with.
    if (serial !== SERIAL) return v5Reply(seq, [0x06, 0x00]);
    const pdu = frame.subarray(11 + 15, frame.length - 2);
    const unit = pdu[0]!;
    const start = (pdu[2]! << 8) | pdu[3]!;
    const count = (pdu[4]! << 8) | pdu[5]!;
    if (this.transientRejects > 0) {
      this.transientRejects--;
      this.rejected.push({ start, count });
      return v5Reply(seq, [0x05, 0x00]);
    }
    if (this.hole !== undefined && start <= this.hole && this.hole < start + count) {
      this.rejected.push({ start, count });
      return v5Reply(seq, [0x05, 0x00]);
    }
    this.reads.push({ start, count });
    const words: number[] = [];
    // Each register reads back as its own address, so a decoded value names the
    // register it came from and a mis-split is legible in the assertion.
    for (let i = 0; i < count; i++) words.push((start + i) >> 8, (start + i) & 0xff);
    return v5Reply(seq, appendCrc([unit, 0x03, count * 2, ...words]));
  }
}

let logger: FakeLogger | undefined;
let transport: ModbusTransport | undefined;

afterEach(async () => {
  await transport?.close();
  transport = undefined;
  await logger?.stop();
  logger = undefined;
});

const connect = async (): Promise<ModbusTransport> => {
  logger = new FakeLogger();
  const port = await logger.listen();
  const conn: InverterConnection = {
    host: "127.0.0.1",
    port,
    unitId: 1,
    transport: "solarman-v5",
    timeoutMs: 2000,
  };
  transport = new ModbusTransport(profile, conn);
  return transport;
};

/**
 * V5 status `05` means, in the stick's own measured behaviour, "the inverter did
 * not answer this request". That covers BOTH an address the inverter will never
 * serve AND a logger-to-inverter RS485 round trip that simply timed out under
 * load — and the wire carries nothing that tells them apart.
 *
 * The consequences are wildly asymmetric. A structural refusal must reach the
 * split-and-remember fallback; a transient one must not, because that fallback
 * is PERMANENT: it splices `this.blocks` and sets `degraded`, neither of which
 * is ever undone, so one busy-stick refusal would split the atomic group and
 * flag every later sample degraded for the life of the process. With the stick
 * measured at 96-215 ms per round trip and 3.2 s for a full poll under cloud
 * contention, a transient refusal is expected, not exotic.
 *
 * So the port retries the identical request ONCE before concluding anything:
 * answered on retry ⇒ transient, serve the data; refused twice ⇒ structural,
 * synthesize exception 2. One extra round trip is the cheapest honest
 * discriminator available — the only alternative that distinguishes them is
 * asking again.
 */
describe("a transient refusal costs one poll, not the process lifetime", () => {
  test("a single `05` is retried and the answer is served, with no degradation", async () => {
    const t = await connect();
    // A device with no unreadable register at all, so the ONLY refusal in this
    // run is the transient one — otherwise the retry meets the structural hole
    // and proves nothing.
    logger!.hole = undefined;
    // Refuse the very first read of the atomic span once, then behave.
    logger!.transientRejects = 1;

    const { values, degraded } = await t.read();

    expect(values["a"]).toBe(100);
    expect(values["b"]).toBe(110);
    // Not degraded: the group kept its single transaction, on the retry.
    expect(degraded).toBeUndefined();
    // Refused once, then served the SAME span rather than two split halves.
    expect(logger!.rejected).toEqual([{ start: 100, count: 11 }]);
    expect(logger!.reads).toEqual([{ start: 100, count: 11 }]);
  });

  test("the read plan is left intact, so the next poll still asks for the span", async () => {
    const t = await connect();
    logger!.hole = undefined;
    logger!.transientRejects = 1;
    await t.read();
    logger!.reads.length = 0;
    logger!.rejected.length = 0;

    const { degraded } = await t.read();

    // The defect this pins: `narrow()` splices `this.blocks` permanently, so a
    // single transient refusal used to amputate the atomic group forever.
    expect(logger!.reads).toEqual([{ start: 100, count: 11 }]);
    expect(logger!.rejected).toEqual([]);
    expect(degraded).toBeUndefined();
  });
});

describe("a Solarman reject drives the split-and-remember fallback end to end", () => {
  test("the atomic block is refused, split, and both halves are then read", async () => {
    const t = await connect();
    const { values, degraded } = await t.read();

    // The refusal arrived as a V5 reject — there is no Modbus exception anywhere
    // on this wire — and still reached `isIllegalDataAddress`. Twice, because a
    // refusal only counts as structural once asking again has been refused too.
    expect(logger!.rejected).toEqual([
      { start: 100, count: 11 },
      { start: 100, count: 11 },
    ]);
    expect(logger!.reads).toEqual([
      { start: 100, count: 1 },
      { start: 110, count: 1 },
    ]);
    expect(values["a"]).toBe(100);
    expect(values["b"]).toBe(110);
    // Every sample from here on is assembled from transactions ms apart, and the
    // transport says so rather than quietly pretending to a snapshot.
    expect(degraded).toBe(true);
  });

  test("the split is REMEMBERED: the second poll never asks for the span again", async () => {
    const t = await connect();
    await t.read();
    logger!.reads.length = 0;
    logger!.rejected.length = 0;

    const { values, degraded } = await t.read();

    expect(logger!.rejected).toEqual([]);
    expect(logger!.reads).toEqual([
      { start: 100, count: 1 },
      { start: 110, count: 1 },
    ]);
    expect(values["a"]).toBe(100);
    expect(degraded).toBe(true);
  });

  test("the refusal costs a round trip, not the transaction timeout", async () => {
    const t = await connect();
    const started = performance.now();
    await t.read();
    // `timeoutMs` is 2000 above. Before the translation the dropped reject left
    // modbus-serial with no reply at all and this poll cost the full budget —
    // on every poll, forever, for any profile declaring a register this inverter
    // will not serve.
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test("the logger serial is discovered over the same connection", async () => {
    const t = await connect();
    await t.read();
    // The probe is answered by the very reject shape this suite is about, so a
    // regression in reject handling would break discovery too.
    expect(t.loggerSerial).toBe(SERIAL);
  });
});

/**
 * The routine failure this framing is the FIRST one able to reach: a peer reset
 * on an already-open port.
 *
 * modbus-serial registers its own `_onError` on whatever port `open()` was given
 * and re-emits the error on the `ModbusRTU` client (`index.js:629`). Nothing in
 * this codebase listens for `"error"` on that client, so a bare `"error"` from
 * the port is an unhandled `EventEmitter` error: Node throws, `apps/server`
 * installs no `uncaughtException` handler, and the whole poller process exits.
 * modbus-serial's own TCP ports cannot get here — `ports/tcpport.js:157` folds a
 * socket error into its callback and never emits it — so this is new with the
 * Solarman port, and it has to be proven at THIS layer: a real client, a real
 * socket, and deliberately no `"error"` listener of the test's own to absorb it.
 *
 * A reset is the stick's own behaviour under load, so the bar is not "a tidy
 * error object" but "the next poll reads".
 */
describe("a peer reset on an open Solarman port", () => {
  test("does not raise an unhandled error, and the next poll reconnects and reads", async () => {
    const t = await connect();
    await t.read();

    logger!.resetClients();
    // Let the RST land and the port tear its socket down before polling again.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const { values } = await t.read();
    expect(values["a"]).toBe(100);
    expect(values["b"]).toBe(110);
  });

  test("a reset with a transaction in flight fails that poll and leaves the next one healthy", async () => {
    const t = await connect();
    const reading = t.read();
    // The RST arrives while a block's transaction is still outstanding — the
    // shape that reproduced the crash, since the port is open and modbus-serial
    // is waiting on it.
    await new Promise((resolve) => setTimeout(resolve, 5));
    logger!.resetClients();
    await reading.catch(() => {});

    await new Promise((resolve) => setTimeout(resolve, 50));
    const { values } = await t.read();
    expect(values["a"]).toBe(100);
  });
});
