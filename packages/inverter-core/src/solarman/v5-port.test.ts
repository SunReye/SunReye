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

/** The wrong-serial reject: the two-byte `06 00` payload, real serial in the header. */
const v5Status = (serial: number, seq: number): Uint8Array =>
  v5Reply(serial, seq, Uint8Array.from([0x06, 0x00]));

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

  /** The peer hanging up — routine here: the stick accepts ONE client. */
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

  test("a status/reject frame — `06 00` is not a PDU", async () => {
    const { socket, emitted } = await openWithEmissions();
    socket().deliver(v5Status(SERIAL, 1));
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
    // Routine, not exceptional: the stick accepts exactly one TCP client, and the
    // Solarman cloud steals the slot. `ModbusTransport.getClient()` builds a
    // fresh client on the next call once `isOpen` is false.
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

  test("a socket error after open re-emits and flips isOpen", async () => {
    const { port, socket } = await openDiscovering();
    const errors: Error[] = [];
    port.on("error", (e: Error) => errors.push(e));
    socket().fail(new Error("ECONNRESET"));
    expect(port.isOpen).toBe(false);
    expect(errors.map((e) => e.message)).toEqual(["ECONNRESET"]);
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
