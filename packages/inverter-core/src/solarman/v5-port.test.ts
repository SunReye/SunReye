import { describe, expect, test } from "bun:test";
import ModbusRTU from "modbus-serial";

import { checksum, decodeFrame } from "./v5-frame";
import { SolarmanV5Port } from "./v5-port";
import type { SolarmanSocket, SolarmanSocketHandlers } from "./v5-port";

const SERIAL = 0xbce20a25;
const OTHER_SERIAL = 0x11223344;

/** Modbus RTU CRC16, appended — the port must pass this through untouched. */
const withCrc = (...body: number[]): Uint8Array => {
  let crc = 0xffff;
  for (const b of body) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
  }
  return Uint8Array.from([...body, crc & 0xff, (crc >> 8) & 0xff]);
};

/** Frame a reply the way the stick does: 14-byte business field, then the payload. */
const v5Reply = (serial: number, seq: number, payload: Uint8Array): Uint8Array => {
  const payloadLength = 14 + payload.length;
  const frame = new Uint8Array(11 + payloadLength + 2);
  const view = new DataView(frame.buffer);
  frame[0] = 0xa5;
  view.setUint16(1, payloadLength, true);
  view.setUint16(3, 0x1510, true);
  view.setUint16(5, seq, true);
  view.setUint32(7, serial >>> 0, true);
  frame[11] = 0x02;
  frame[12] = 0x01;
  frame.set(payload, 11 + 14);
  frame[frame.length - 1] = 0x15;
  frame[frame.length - 2] = checksum(frame);
  return frame;
};

/** A V5 reject: a two-byte `<status> 00` payload, real serial in the header. */
const v5Reject = (serial: number, seq: number, status: number): Uint8Array =>
  v5Reply(serial, seq, Uint8Array.from([status, 0x00]));

/** The wrong-serial reject: the two-byte `06 00` payload, real serial in the header. */
const v5Status = (serial: number, seq: number): Uint8Array => v5Reject(serial, seq, 0x06);

/** Hex text (spaces optional) → bytes, so the golden vectors stay readable. */
const bytes = (text: string): Uint8Array =>
  Uint8Array.from(
    text
      .trim()
      .split(/\s+/)
      .map((b) => Number.parseInt(b, 16)),
  );

/**
 * Captured verbatim from the stick (logger serial 3168930341 = 0xBCE20A25).
 * Sequence low byte 0x02, so a test has to burn one transaction before this
 * vector answers the outstanding one — which is the point of using the real
 * bytes rather than a synthesised frame with a convenient sequence.
 *
 * Produced identically by register address 60000, by address 9000 and by a
 * 200-register read: the inverter would not answer, and the logger says so
 * ITSELF rather than forwarding a Modbus exception. That is the defect this
 * whole translation exists for.
 */
const CAPTURED_REJECT_05 = bytes(
  "a5 10 00 10 15 02 6c 25 0a e2 bc 02 01 87 12 18 01 f6 09 00 00 32 34 90 69 05 00 88 15",
);

/**
 * Captured verbatim: the reply to a request that named the wrong logger serial.
 * Sent with serial 1, 0, 0xFFFFFFFF and serial+1, all four identical in shape.
 * Sequence low byte 0x01.
 */
const CAPTURED_REJECT_06 = bytes(
  "a5 10 00 10 15 01 39 25 0a e2 bc 02 01 ab 0b 18 01 19 03 00 00 31 34 90 69 06 00 8e 15",
);

/**
 * Captured verbatim: the heartbeat the stick emits unprompted on an idle socket.
 * Control code 0x4710 and a one-byte payload — the only unsolicited frame we
 * have actually observed, and the reason "nothing outstanding" must stay a
 * silent drop rather than becoming an error of its own.
 */
const CAPTURED_HEARTBEAT = bytes("a5 01 00 10 47 04 6f 25 0a e2 bc 00 98 15");

/** A logger heartbeat — a control code we have no business acting on. */
const v5Heartbeat = (): Uint8Array => {
  const frame = v5Reply(SERIAL, 1, withCrc(0x01, 0x03, 0x02, 0x00, 0x00));
  const view = new DataView(frame.buffer);
  view.setUint16(3, 0x4710, true);
  frame[frame.length - 2] = checksum(frame);
  return frame;
};

const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ");

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/**
 * An in-memory stand-in for the TCP socket. Injected through `createSocket`
 * rather than mocked at the module level: `mock.module` is process-global and
 * permanent, and a port is exactly the kind of thing that wants a dozen
 * differently-behaved doubles in one file.
 */
class FakeSocket implements SolarmanSocket {
  readonly writes: Uint8Array[] = [];
  readonly dials: { host: string; port: number }[] = [];
  ended = false;
  destroyed = false;
  /** Set to false for a socket that never finishes connecting. */
  autoConnect = true;
  /** Answers each request; return no frames to model a logger that says nothing. */
  respond: (request: Uint8Array) => Uint8Array[] = () => [];

  constructor(private readonly handlers: SolarmanSocketHandlers) {}

  connect(options: { host: string; port: number }): void {
    this.dials.push(options);
    if (this.autoConnect) queueMicrotask(() => this.handlers.onConnect());
  }

  write(data: Uint8Array): void {
    this.writes.push(Uint8Array.from(data));
    const replies = this.respond(Uint8Array.from(data));
    if (replies.length > 0) queueMicrotask(() => this.deliver(concat(...replies)));
  }

  end(): void {
    this.ended = true;
    this.handlers.onClose();
  }

  destroy(): void {
    this.destroyed = true;
  }

  /** Push bytes up as one TCP read. */
  deliver(chunk: Uint8Array): void {
    this.handlers.onData(chunk);
  }

  /** The peer hanging up — routine here: the stick hangs up freely under load. */
  peerClose(): void {
    this.handlers.onClose();
  }

  fail(err: Error): void {
    this.handlers.onError(err);
  }

  /** The serial the port asked with, per request it sent. */
  serialsAsked(): number[] {
    return this.writes.map((w) => new DataView(w.buffer, w.byteOffset).getUint32(7, true));
  }
}

/** A port plus the fake socket it will build, without opening either yet. */
const makePort = (opts: { loggerSerial?: number; timeoutMs?: number } = {}) => {
  let socket: FakeSocket | undefined;
  const port = new SolarmanV5Port({
    host: "10.20.0.63",
    port: 8899,
    timeoutMs: opts.timeoutMs ?? 50,
    ...(opts.loggerSerial === undefined ? {} : { loggerSerial: opts.loggerSerial }),
    createSocket: (handlers) => {
      socket = new FakeSocket(handlers);
      return socket;
    },
  });
  return {
    port,
    /** The socket only exists once `open` has run. */
    socket: () => {
      if (!socket) throw new Error("socket not created yet");
      return socket;
    },
  };
};

/** Open the port, answering the discovery probe as the captured stick does. */
const openDiscovering = async (opts: { loggerSerial?: number } = {}) => {
  const h = makePort(opts);
  const opened = new Promise<Error | undefined>((resolve) => h.port.open(resolve));
  // The socket exists synchronously: `open` builds and dials it.
  h.socket().respond = (req) => [v5Status(SERIAL, req[5]! | (req[6]! << 8))];
  const err = await opened;
  return { ...h, err };
};

describe("SolarmanV5Port — opening", () => {
  test("dials the configured host and port", async () => {
    const { socket, err } = await openDiscovering();
    expect(err).toBeUndefined();
    expect(socket().dials).toEqual([{ host: "10.20.0.63", port: 8899 }]);
  });

  test("discovers the logger serial when none was configured", async () => {
    const { port, socket, err } = await openDiscovering();
    expect(err).toBeUndefined();
    expect(port.loggerSerial).toBe(SERIAL);
    // The probe deliberately asks with serial 0: a stick rejects that at the
    // dongle, without forwarding anything to the RS485 bus, so a reply is
    // guaranteed whatever unit id lives behind it.
    expect(socket().serialsAsked()).toEqual([0]);
    expect(port.isOpen).toBe(true);
  });

  test("a WRONG configured serial is corrected from the reply header", async () => {
    const { port, err } = await openDiscovering({ loggerSerial: OTHER_SERIAL });
    expect(err).toBeUndefined();
    // The logger names itself in every reply header, right or wrong guess. A
    // stale stored serial would otherwise poll a dead endpoint forever.
    expect(port.loggerSerial).toBe(SERIAL);
  });

  test("a correct configured serial survives the probe unchanged", async () => {
    const { port } = await openDiscovering({ loggerSerial: SERIAL });
    expect(port.loggerSerial).toBe(SERIAL);
  });

  test("a silent logger falls back to the configured serial rather than refusing to open", async () => {
    const h = makePort({ loggerSerial: SERIAL, timeoutMs: 20 });
    const err = await new Promise<Error | undefined>((resolve) => h.port.open(resolve));
    expect(err).toBeUndefined();
    expect(h.port.loggerSerial).toBe(SERIAL);
    expect(h.port.isOpen).toBe(true);
  });

  test("a silent logger with no configured serial fails the open", async () => {
    const h = makePort({ timeoutMs: 20 });
    const err = await new Promise<Error | undefined>((resolve) => h.port.open(resolve));
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toContain("serial");
    expect(h.port.isOpen).toBe(false);
  });

  test("open times out when the socket never connects", async () => {
    let socket: FakeSocket | undefined;
    const port = new SolarmanV5Port({
      host: "10.20.0.63",
      port: 8899,
      timeoutMs: 20,
      createSocket: (handlers) => {
        socket = new FakeSocket(handlers);
        socket.autoConnect = false;
        return socket;
      },
    });
    const err = await new Promise<Error | undefined>((resolve) => port.open(resolve));
    expect(err?.message).toContain("timed out");
    expect(port.isOpen).toBe(false);
    // The half-open socket must not be left dangling on a failed connect.
    expect(socket?.destroyed).toBe(true);
  });

  test("a socket error during connect fails the open with that error", async () => {
    let socket: FakeSocket | undefined;
    const port = new SolarmanV5Port({
      host: "10.20.0.63",
      port: 8899,
      timeoutMs: 50,
      createSocket: (handlers) => {
        socket = new FakeSocket(handlers);
        socket.autoConnect = false;
        return socket;
      },
    });
    const opened = new Promise<Error | undefined>((resolve) => port.open(resolve));
    socket?.fail(new Error("ECONNREFUSED"));
    expect((await opened)?.message).toContain("ECONNREFUSED");
    expect(port.isOpen).toBe(false);
  });
});

describe("SolarmanV5Port — framing a transaction", () => {
  test("wraps the RTU frame with the discovered serial and a fresh sequence", async () => {
    const { port, socket } = await openDiscovering();
    socket().respond = () => [];
    const rtu = withCrc(0x01, 0x03, 0x00, 0x03, 0x00, 0x06);
    port.write(rtu);
    const sent = socket().writes.at(-1)!;
    expect(new DataView(sent.buffer, sent.byteOffset).getUint32(7, true)).toBe(SERIAL);
    // Sequence 0 went out on the discovery probe, so the first transaction is 1.
    expect(sent[5]).toBe(1);
    expect(hex(sent.subarray(11 + 15, sent.length - 2))).toBe(hex(rtu));
  });

  test("the sequence advances per transaction and wraps inside a byte", async () => {
    const { port, socket } = await openDiscovering();
    socket().respond = () => [];
    const rtu = withCrc(0x01, 0x03, 0x00, 0x03, 0x00, 0x06);
    for (let i = 0; i < 300; i++) port.write(rtu);
    const seqs = socket()
      .writes.slice(1)
      .map((w) => w[5]!);
    expect(seqs[0]).toBe(1);
    expect(seqs[254]).toBe(255);
    // Only the LOW byte is echoed, so the counter lives in a byte on purpose.
    expect(seqs[255]).toBe(0);
    expect(seqs.every((s) => s <= 0xff)).toBe(true);
  });

  test("emits the inner RTU frame, CRC included, when the reply matches", async () => {
    const { port, socket } = await openDiscovering();
    socket().respond = () => [];
    const emitted: Buffer[] = [];
    port.on("data", (d: Buffer) => emitted.push(d));
    port.write(withCrc(0x01, 0x03, 0x00, 0x03, 0x00, 0x06));
    const pdu = withCrc(0x01, 0x03, 0x02, 0x12, 0x34);
    // High byte 0x0d is the logger's own counter — only the low byte echoes.
    socket().deliver(v5Reply(SERIAL, 0x0d01, pdu));
    expect(emitted.map(hex)).toEqual([hex(pdu)]);
  });

  test("the emitted value is a Buffer — modbus-serial's parser calls readUInt16LE on it", async () => {
    const { port, socket } = await openDiscovering();
    socket().respond = () => [];
    const emitted: unknown[] = [];
    port.on("data", (d: unknown) => emitted.push(d));
    port.write(withCrc(0x01, 0x03, 0x00, 0x03, 0x00, 0x06));
    socket().deliver(v5Reply(SERIAL, 1, withCrc(0x01, 0x03, 0x02, 0x12, 0x34)));
    expect(Buffer.isBuffer(emitted[0])).toBe(true);
  });

  test("a Modbus exception reply reaches modbus-serial intact, so modbusCode survives", async () => {
    const { port, socket } = await openDiscovering();
    socket().respond = () => [];
    const emitted: Buffer[] = [];
    port.on("data", (d: Buffer) => emitted.push(d));
    port.write(withCrc(0x01, 0x03, 0x00, 0x03, 0x00, 0x06));
    // Exception 2, illegal data address — the signal `ModbusTransport` sniffs to
    // split an atomic group. Rewriting it into an error of our own would make the
    // split-and-remember fallback unreachable.
    const exception = withCrc(0x01, 0x83, 0x02);
    socket().deliver(v5Reply(SERIAL, 1, exception));
    expect(emitted.map(hex)).toEqual([hex(exception)]);
  });
});

describe("SolarmanV5Port — what must never be emitted", () => {
  const openWithEmissions = async () => {
    const h = await openDiscovering();
    h.socket().respond = () => [];
    const emitted: Buffer[] = [];
    h.port.on("data", (d: Buffer) => emitted.push(d));
    h.port.write(withCrc(0x01, 0x03, 0x00, 0x03, 0x00, 0x06));
    return { ...h, emitted };
  };

  test("a reply for a stray sequence", async () => {
    const { socket, emitted } = await openWithEmissions();
    socket().deliver(v5Reply(SERIAL, 0x0d09, withCrc(0x01, 0x03, 0x02, 0x12, 0x34)));
    expect(emitted).toEqual([]);
  });

  test("a reply from a different logger", async () => {
    const { socket, emitted } = await openWithEmissions();
    socket().deliver(v5Reply(OTHER_SERIAL, 1, withCrc(0x01, 0x03, 0x02, 0x12, 0x34)));
    expect(emitted).toEqual([]);
  });

  test("a status/reject frame for a sequence nobody is waiting on", async () => {
    const { socket, emitted } = await openWithEmissions();
    // Outstanding is 1; this reject answers 9. Translating it would fail the
    // wrong transaction — the one still legitimately in flight.
    socket().deliver(v5Status(SERIAL, 9));
    expect(emitted).toEqual([]);
  });

  test("a heartbeat", async () => {
    const { socket, emitted } = await openWithEmissions();
    socket().deliver(v5Heartbeat());
    expect(emitted).toEqual([]);
  });

  test("a frame with a corrupted checksum", async () => {
    const { socket, emitted } = await openWithEmissions();
    const frame = v5Reply(SERIAL, 1, withCrc(0x01, 0x03, 0x02, 0x12, 0x34));
    frame[frame.length - 2] = frame[frame.length - 2]! ^ 0xff;
    socket().deliver(frame);
    expect(emitted).toEqual([]);
  });

  test("a duplicate of a reply already delivered", async () => {
    const { socket, emitted } = await openWithEmissions();
    const frame = v5Reply(SERIAL, 1, withCrc(0x01, 0x03, 0x02, 0x12, 0x34));
    socket().deliver(frame);
    socket().deliver(frame);
    // modbus-serial would run the transaction callback twice on the second one.
    expect(emitted).toHaveLength(1);
  });

  test("anything at all once the stream has desynchronised — the buffer is dropped", async () => {
    const { socket, emitted } = await openWithEmissions();
    const frame = v5Reply(SERIAL, 1, withCrc(0x01, 0x03, 0x02, 0x12, 0x34));
    socket().deliver(concat(Uint8Array.from([0x00, 0x00, 0x00]), frame));
    expect(emitted).toEqual([]);
    // …and the dropped buffer must not poison the next, well-formed read.
    socket().deliver(frame);
    expect(emitted).toHaveLength(1);
  });
});

describe("SolarmanV5Port — reassembly", () => {
  test("two frames in one TCP chunk are both parsed; only the matching one is emitted", async () => {
    const { port, socket } = await openDiscovering();
    socket().respond = () => [];
    const emitted: Buffer[] = [];
    port.on("data", (d: Buffer) => emitted.push(d));
    port.write(withCrc(0x01, 0x03, 0x00, 0x03, 0x00, 0x06));
    const pdu = withCrc(0x01, 0x03, 0x02, 0x12, 0x34);
    socket().deliver(concat(v5Heartbeat(), v5Reply(SERIAL, 0x0d01, pdu)));
    expect(emitted.map(hex)).toEqual([hex(pdu)]);
  });

  test("a frame split across two reads is emitted once whole", async () => {
    const { port, socket } = await openDiscovering();
    socket().respond = () => [];
    const emitted: Buffer[] = [];
    port.on("data", (d: Buffer) => emitted.push(d));
    port.write(withCrc(0x01, 0x03, 0x00, 0x03, 0x00, 0x06));
    const pdu = withCrc(0x01, 0x03, 0x02, 0x12, 0x34);
    const frame = v5Reply(SERIAL, 1, pdu);
    socket().deliver(frame.slice(0, 9));
    expect(emitted).toEqual([]);
    socket().deliver(frame.slice(9));
    expect(emitted.map(hex)).toEqual([hex(pdu)]);
  });

  test("an empty read changes nothing", async () => {
    const { port, socket } = await openDiscovering();
    socket().respond = () => [];
    const emitted: Buffer[] = [];
    port.on("data", (d: Buffer) => emitted.push(d));
    port.write(withCrc(0x01, 0x03, 0x00, 0x03, 0x00, 0x06));
    socket().deliver(new Uint8Array(0));
    expect(emitted).toEqual([]);
  });
});

describe("SolarmanV5Port — closing", () => {
  test("the peer hanging up flips isOpen and re-emits close", async () => {
    const { port, socket } = await openDiscovering();
    const closes: number[] = [];
    port.on("close", () => closes.push(1));
    // Routine, not exceptional: the stick hangs up freely (a reset under load,
    // its own reboot, the network). `ModbusTransport.getClient()` builds a fresh
    // client on the next call once `isOpen` is false. NOT because a second
    // client evicts us — measured on the live stick, it does not; two concurrent
    // clients both read every metric, serialised on the RS485 bus.
    socket().peerClose();
    expect(port.isOpen).toBe(false);
    expect(closes).toHaveLength(1);
  });

  test("a second close from the peer does not re-emit", async () => {
    const { port, socket } = await openDiscovering();
    const closes: number[] = [];
    port.on("close", () => closes.push(1));
    socket().peerClose();
    socket().peerClose();
    expect(closes).toHaveLength(1);
  });

  /**
   * No `"error"` listener is attached here, ON PURPOSE. The previous version of
   * this test attached one, which is precisely what hid the defect: an
   * `EventEmitter` with a listener does not throw, so the emit looked harmless
   * here while being fatal in production — modbus-serial re-emits a port
   * `"error"` on the `ModbusRTU` client, where nobody listens and Node throws.
   */
  test("a socket error after open closes the port instead of emitting a fatal `error`", async () => {
    const { port, socket } = await openDiscovering();
    const closes: number[] = [];
    const reported: Error[] = [];
    port.on("close", () => closes.push(1));
    port.on("port-error", (e: Error) => reported.push(e));

    // Unhandled `"error"` on an EventEmitter throws; this would be the crash.
    expect(() => socket().fail(new Error("read ECONNRESET"))).not.toThrow();

    expect(port.isOpen).toBe(false);
    // The signal `ModbusTransport.getClient()` needs to build a fresh client.
    expect(closes).toHaveLength(1);
    // The cause is still reported, just not under a name a library re-emits.
    expect(reported.map((e) => e.message)).toEqual(["read ECONNRESET"]);
    // The dead socket is torn down rather than left half-open.
    expect(socket().destroyed).toBe(true);
  });

  test("the socket's own close after an error does not re-emit close a second time", async () => {
    const { port, socket } = await openDiscovering();
    const closes: number[] = [];
    port.on("close", () => closes.push(1));
    socket().fail(new Error("read ECONNRESET"));
    // A real net.Socket emits "close" after "error"; the port must idempotently
    // ignore the second notification rather than churn the client twice.
    socket().peerClose();
    expect(closes).toHaveLength(1);
  });

  test("close ends the socket and calls back", async () => {
    const { port, socket } = await openDiscovering();
    await new Promise<void>((resolve) => port.close(() => resolve()));
    expect(socket().ended).toBe(true);
    expect(port.isOpen).toBe(false);
  });

  test("closing a port that was never opened still calls back", async () => {
    const h = makePort();
    await new Promise<void>((resolve) => h.port.close(() => resolve()));
    expect(h.port.isOpen).toBe(false);
  });

  test("destroy tears the socket down and calls back", async () => {
    const { port, socket } = await openDiscovering();
    await new Promise<void>((resolve) => port.destroy(() => resolve()));
    expect(socket().destroyed).toBe(true);
    expect(port.isOpen).toBe(false);
  });

  test("a write after the socket closed is dropped rather than thrown", async () => {
    const { port, socket } = await openDiscovering();
    socket().respond = () => [];
    socket().peerClose();
    const before = socket().writes.length;
    expect(() => port.write(withCrc(0x01, 0x03, 0x00, 0x03, 0x00, 0x06))).not.toThrow();
    expect(socket().writes).toHaveLength(before);
  });
});

/**
 * The point of implementing modbus-serial's port contract rather than a codec of
 * our own: `new ModbusRTU(port)` then gives FC03 and FC16 for free, and keeps
 * owning CRC checking, transaction timeouts and exception mapping.
 */
describe("SolarmanV5Port — driven by a real ModbusRTU client", () => {
  const openClient = async () => {
    let socket: FakeSocket | undefined;
    const port = new SolarmanV5Port({
      host: "10.20.0.63",
      port: 8899,
      timeoutMs: 100,
      createSocket: (handlers) => {
        socket = new FakeSocket(handlers);
        socket.respond = (req) => [v5Status(SERIAL, req[5]! | (req[6]! << 8))];
        return socket;
      },
    });
    const client = new ModbusRTU(port);
    await new Promise<void>((resolve, reject) =>
      client.open((err?: Error) => (err ? reject(err) : resolve())),
    );
    client.setID(1);
    client.setTimeout(200);
    return { client, port, socket: socket! };
  };

  test("reads holding registers end to end through the V5 envelope", async () => {
    const { client, socket } = await openClient();
    socket.respond = (req) => {
      const inner = req.subarray(11 + 15, req.length - 2);
      expect(inner[1]).toBe(0x03);
      return [
        v5Reply(
          SERIAL,
          // Echo the low byte and add a counter of our own, as the stick does.
          (0x0d << 8) | req[5]!,
          withCrc(0x01, 0x03, 0x04, 0x00, 0x2a, 0x00, 0x2b),
        ),
      ];
    };
    const { data } = await client.readHoldingRegisters(3, 2);
    expect(data).toEqual([42, 43]);
  });

  test("writes a register with FC16 and accepts the echoed reply", async () => {
    const { client, socket } = await openClient();
    socket.respond = (req) => [
      v5Reply(SERIAL, req[5]!, withCrc(0x01, 0x10, 0x00, 0x6c, 0x00, 0x01)),
    ];
    await client.writeRegisters(108, [149]);
    const request = decodeFrame(socket.writes.at(-1)!);
    expect(request.kind).toBe("other");
    const inner = socket.writes.at(-1)!.subarray(11 + 15);
    expect(inner[1]).toBe(0x10);
  });

  test("exception 2 arrives as err.modbusCode === 2, which drives the atomic-group fallback", async () => {
    const { client, socket } = await openClient();
    socket.respond = (req) => [v5Reply(SERIAL, req[5]!, withCrc(0x01, 0x83, 0x02))];
    const err: unknown = await client.readHoldingRegisters(3, 90).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect((err as { modbusCode?: number }).modbusCode).toBe(2);
  });

  test("a logger that answers nothing times out as a Modbus transaction, not a hang", async () => {
    const { client, socket } = await openClient();
    socket.respond = () => [];
    const err: unknown = await client.readHoldingRegisters(3, 2).then(
      () => undefined,
      (e: unknown) => e,
    );
    // modbus-serial owns the deadline, so this is its own TransactionTimedOutError
    // (which notably does not extend Error) rather than anything we invented.
    expect((err as { name?: string }).name).toBe("TransactionTimedOutError");
    expect((err as { errno?: string }).errno).toBe("ETIMEDOUT");
  });
});

/**
 * The defect this suite pins: a Solarman logger NEVER forwards a real Modbus
 * exception PDU. Every in-range read we probed on a live Deye came back with
 * data; only out-of-map and oversize requests came back at all, and they came
 * back as a V5-level reject (`05 00`) rather than as `01 83 02`. Dropped, that
 * reject leaves modbus-serial with no reply, so every poll burns the FULL
 * transaction timeout — forever, for any profile that declares one register this
 * inverter will not serve — and `isIllegalDataAddress` can never fire, so the
 * atomic-group fallback never narrows the block it should.
 */
describe("SolarmanV5Port — a refused request fails fast instead of hanging", () => {
  /** Open, then send one request so there is an outstanding transaction. */
  const openWithOutstanding = async (rtu?: Uint8Array) => {
    const h = await openDiscovering();
    h.socket().respond = () => [];
    const emitted: Buffer[] = [];
    const rejects: Error[] = [];
    h.port.on("data", (d: Buffer) => emitted.push(d));
    h.port.on("reject", (e: Error) => rejects.push(e));
    h.port.write(rtu ?? withCrc(0x01, 0x03, 0x00, 0x03, 0x00, 0x06));
    return { ...h, emitted, rejects };
  };

  test("the captured `05` reject becomes the exception-2 frame for the outstanding FC03", async () => {
    const h = await openWithOutstanding();
    // The capture's sequence low byte is 0x02, so burn sequence 1 first: these
    // are the stick's real bytes, not bytes chosen to be convenient.
    h.port.write(withCrc(0x01, 0x03, 0x00, 0x03, 0x00, 0x06));
    h.socket().deliver(CAPTURED_REJECT_05);
    // `01 83 02` + CRC16 — well-formed, so modbus-serial parses it instead of
    // discarding it as noise, and the caller gets modbusCode 2.
    expect(h.emitted.map(hex)).toEqual(["01 83 02 c0 f1"]);
  });

  test("the synthesized exception carries the OUTSTANDING request's unit id and function code", async () => {
    // Unit 5, FC16: neither value can come from the reject frame, which carries
    // no PDU at all — both have to be remembered from the request.
    const h = await openWithOutstanding(
      withCrc(0x05, 0x10, 0x00, 0x6c, 0x00, 0x01, 0x02, 0x00, 0x95),
    );
    h.socket().deliver(v5Reject(SERIAL, 1, 0x05));
    expect(h.emitted.map(hex)).toEqual(["05 90 02 8c 00"]);
  });

  test("a `05` reject is still reported as itself, naming the raw V5 status", async () => {
    const h = await openWithOutstanding();
    h.socket().deliver(v5Reject(SERIAL, 1, 0x05));
    // The translation is deliberate, not a pretence: the record has to still say
    // what the wire actually carried, or a real diagnosis is impossible.
    expect(h.rejects).toHaveLength(1);
    expect(h.rejects[0]!.message).toContain("0x05");
  });

  test("the captured `06` reject is an ADDRESSING failure, never exception 2", async () => {
    const h = await openWithOutstanding();
    h.socket().deliver(CAPTURED_REJECT_06);
    const frame = h.emitted[0]!;
    // Exception 2 here would have `ModbusTransport` quietly amputate registers
    // from the read plan because the configured logger serial is wrong.
    expect(frame[2]).not.toBe(0x02);
    expect(hex(frame)).toBe("01 83 0a c1 37");
  });

  test("a `06` reject names the logger's REAL serial, which its own header carries", async () => {
    const h = await openWithOutstanding();
    h.socket().deliver(CAPTURED_REJECT_06);
    expect(h.rejects).toHaveLength(1);
    // Decimal: that is how the serial is printed on the sticker and shown in the UI.
    expect(h.rejects[0]!.message).toContain("3168930341");
    expect(h.rejects[0]!.message).toContain("0x06");
  });

  test("a `06` reject carrying a different serial than ours is still acted on", async () => {
    const h = await openWithOutstanding();
    // The mismatch IS the report. Dropping it as "not our logger" would turn the
    // one frame that explains the problem into silence.
    h.socket().deliver(v5Reject(OTHER_SERIAL, 1, 0x06));
    expect(h.emitted).toHaveLength(1);
    expect(h.rejects[0]!.message).toContain(String(OTHER_SERIAL));
  });

  test("an unknown status code fails the transaction rather than hanging", async () => {
    const h = await openWithOutstanding();
    h.socket().deliver(v5Reject(SERIAL, 1, 0x09));
    expect(h.emitted).toHaveLength(1);
    // Not 2: only the one measured meaning earns the split-and-remember path.
    expect(h.emitted[0]![2]).toBe(0x0b);
    expect(h.rejects[0]!.message).toContain("0x09");
  });

  test("a reject with NO request outstanding is dropped", async () => {
    const h = await openDiscovering();
    h.socket().respond = () => [];
    const emitted: Buffer[] = [];
    const rejects: Error[] = [];
    h.port.on("data", (d: Buffer) => emitted.push(d));
    h.port.on("reject", (e: Error) => rejects.push(e));
    h.socket().deliver(CAPTURED_REJECT_05);
    expect(emitted).toEqual([]);
    expect(rejects).toEqual([]);
  });

  test("the captured heartbeat with nothing outstanding is dropped silently", async () => {
    const h = await openDiscovering();
    h.socket().respond = () => [];
    const emitted: Buffer[] = [];
    const rejects: Error[] = [];
    h.port.on("data", (d: Buffer) => emitted.push(d));
    h.port.on("reject", (e: Error) => rejects.push(e));
    h.socket().deliver(CAPTURED_HEARTBEAT);
    expect(emitted).toEqual([]);
    expect(rejects).toEqual([]);
  });

  test("the captured heartbeat does not disturb a request in flight", async () => {
    const h = await openWithOutstanding();
    h.socket().deliver(CAPTURED_HEARTBEAT);
    expect(h.emitted).toEqual([]);
    expect(h.rejects).toEqual([]);
    // …and the real reply still lands afterwards.
    const pdu = withCrc(0x01, 0x03, 0x02, 0x12, 0x34);
    h.socket().deliver(v5Reply(SERIAL, 0x0d01, pdu));
    expect(h.emitted.map(hex)).toEqual([hex(pdu)]);
  });

  test("a duplicate reject is translated once — the transaction is already failed", async () => {
    const h = await openWithOutstanding();
    h.socket().deliver(v5Reject(SERIAL, 1, 0x05));
    h.socket().deliver(v5Reject(SERIAL, 1, 0x05));
    expect(h.emitted).toHaveLength(1);
  });

  test("a real reply arriving after a reject for the same sequence is ignored", async () => {
    const h = await openWithOutstanding();
    h.socket().deliver(v5Reject(SERIAL, 1, 0x05));
    h.socket().deliver(v5Reply(SERIAL, 1, withCrc(0x01, 0x03, 0x02, 0x12, 0x34)));
    expect(h.emitted.map(hex)).toEqual(["01 83 02 c0 f1"]);
  });

  test("a reject answering the discovery probe still only names the logger", async () => {
    // The probe deliberately asks with serial 0 and is answered by a `06`
    // reject; translating that into an exception during `open` would fail a
    // transaction that does not exist.
    const h = makePort();
    const opened = new Promise<Error | undefined>((resolve) => h.port.open(resolve));
    const emitted: Buffer[] = [];
    h.port.on("data", (d: Buffer) => emitted.push(d));
    h.socket().respond = () => [CAPTURED_REJECT_06];
    expect(await opened).toBeUndefined();
    expect(h.port.loggerSerial).toBe(SERIAL);
    expect(emitted).toEqual([]);
  });
});

/**
 * The half that proves the translation is worth anything: a synthesized
 * exception has to survive modbus-serial's own parser — length, CRC and the
 * `0x80 | nextCode` check — and reach the caller as `err.modbusCode`, or
 * `isIllegalDataAddress` in `modbus-transport.ts` never fires.
 */
describe("SolarmanV5Port — a reject reaching a real ModbusRTU client", () => {
  const openRejecting = async (status: number) => {
    let socket: FakeSocket | undefined;
    const port = new SolarmanV5Port({
      host: "10.20.0.63",
      port: 8899,
      timeoutMs: 100,
      createSocket: (handlers) => {
        socket = new FakeSocket(handlers);
        socket.respond = (req) => [v5Status(SERIAL, req[5]! | (req[6]! << 8))];
        return socket;
      },
    });
    const client = new ModbusRTU(port);
    await new Promise<void>((resolve, reject) =>
      client.open((err?: Error) => (err ? reject(err) : resolve())),
    );
    client.setID(1);
    client.setTimeout(400);
    socket!.respond = (req) => [v5Reject(SERIAL, req[5]!, status)];
    return { client, port };
  };

  const codeOf = async (status: number): Promise<{ code: unknown; ms: number }> => {
    const { client } = await openRejecting(status);
    const started = performance.now();
    const err: unknown = await client.readHoldingRegisters(60000, 2).then(
      () => undefined,
      (e: unknown) => e,
    );
    return { code: (err as { modbusCode?: number }).modbusCode, ms: performance.now() - started };
  };

  test("a `05` reject arrives as modbusCode 2, the signal the split fallback reads", async () => {
    const { code, ms } = await codeOf(0x05);
    expect(code).toBe(2);
    // Fast, not at timeout speed (400ms above): the whole point is that a poll
    // no longer spends its entire budget waiting for a reply that already came.
    expect(ms).toBeLessThan(200);
  });

  test("a `06` reject arrives as a failure that is NOT modbusCode 2", async () => {
    const { code } = await codeOf(0x06);
    expect(code).not.toBe(2);
    expect(code).toBe(10);
  });

  test("an unknown status arrives as a failure that is NOT modbusCode 2", async () => {
    const { code } = await codeOf(0x7f);
    expect(code).not.toBe(2);
    expect(code).toBe(11);
  });
});
