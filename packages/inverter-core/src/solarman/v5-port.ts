/**
 * A modbus-serial PORT that speaks Solarman V5.
 *
 * modbus-serial's `ModbusRTU` is written against a tiny port contract — an
 * EventEmitter with `open`/`close`/`destroy`/`write`/`isOpen` that emits `"data"`
 * carrying a complete RTU frame, CRC16 included. Implementing that contract
 * instead of writing our own Modbus client buys FC03, FC16, transaction
 * timeouts, CRC checking and — the load-bearing one — Modbus exception mapping
 * onto `err.modbusCode`, which is exactly what `modbus-transport.ts` sniffs to
 * drive the exception-2 split-and-remember fallback for atomic read groups.
 *
 * Hence the rule this file obeys everywhere: the inner RTU frame is passed
 * through UNTOUCHED, CRC and all. Anything that looked like a helpful
 * reinterpretation here would sever that fallback.
 *
 * The socket is injected (`createSocket`) rather than imported, mirroring
 * `http-transport.ts`: a framing this fiddly wants a dozen differently-behaved
 * doubles in one test file, and `mock.module` is process-global and permanent.
 */

import { EventEmitter } from "node:events";
import net from "node:net";

import { getLogger } from "@logtape/logtape";

import { decodeFrame, encodeRequest, splitFrames, SolarmanFrameError } from "./v5-frame";

const log = getLogger(["inverter-core", "solarman"]);

/** What the port needs to hear from its socket. */
export interface SolarmanSocketHandlers {
  onConnect(): void;
  onData(chunk: Uint8Array): void;
  onClose(): void;
  onError(err: Error): void;
}

/**
 * What the port needs to DO to its socket — four methods, no event plumbing, so
 * a test double is four lines and fully typed.
 */
export interface SolarmanSocket {
  connect(options: { host: string; port: number }): void;
  write(data: Uint8Array): void;
  end(): void;
  destroy(): void;
}

export type SolarmanSocketFactory = (handlers: SolarmanSocketHandlers) => SolarmanSocket;

/** The real thing: a TCP socket with the handlers wired to its events. */
const tcpSocket: SolarmanSocketFactory = (handlers) => {
  const socket = new net.Socket();
  socket.on("connect", () => handlers.onConnect());
  socket.on("data", (chunk: Buffer) => handlers.onData(chunk));
  socket.on("close", () => handlers.onClose());
  socket.on("error", (err: Error) => handlers.onError(err));
  return socket;
};

export interface SolarmanV5PortOptions {
  host: string;
  /** The logger's TCP port — 8899 on every stick we have seen. */
  port: number;
  /**
   * The logger's serial, when it is already known. Optional because it is
   * printed on a sticker inside the dongle's shell and nobody should have to
   * open one: {@link SolarmanV5Port.open} discovers it, and treats a configured
   * value as a fallback rather than as the truth.
   */
  loggerSerial?: number;
  /** Deadline for connecting, and separately for the discovery probe. */
  timeoutMs: number;
  createSocket?: SolarmanSocketFactory;
}

/**
 * The discovery probe: the captured FC03 "read holding registers 3..8, unit 1".
 *
 * Its CONTENTS are irrelevant and that is the point. The probe goes out with
 * logger serial 0, which no stick has, so the dongle rejects it at the dongle —
 * without forwarding anything onto the RS485 bus — and the reject still names
 * the logger's real serial in its header. Probing with a real serial instead
 * would forward the request to unit 1, and on a plant whose inverter is not
 * unit 1 the bus would answer nothing and the probe would hang.
 */
const PROBE_PDU = Uint8Array.from([0x01, 0x03, 0x00, 0x03, 0x00, 0x06, 0x35, 0xc8]);

/** Serial used for the probe. Never a real logger, always answered. */
const PROBE_SERIAL = 0;

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBufferLike> {
  if (a.length === 0) return b.slice();
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Solarman V5 framing as a modbus-serial port.
 *
 * Deliberately NOT touching `_transactionIdRead` / `_transactionIdWrite`:
 * modbus-serial sets both to 1 in `open()` and RTU semantics leave them there,
 * and `ModbusTransport.locked()` already serialises transactions on the client.
 * Our own sequence number lives alongside them and is what the logger echoes.
 */
export class SolarmanV5Port extends EventEmitter {
  /**
   * Where this port dials. Public because the transport above logs it and the
   * server reports it — and because a port that hides its own address forces
   * every caller to carry a parallel copy of it.
   */
  readonly endpoint: Readonly<{ host: string; port: number }>;
  readonly #timeoutMs: number;
  readonly #configuredSerial: number | undefined;
  readonly #createSocket: SolarmanSocketFactory;

  #socket: SolarmanSocket | null = null;
  #openFlag = false;
  /** Partial frame carried over from the previous TCP read. */
  #buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  /** Next sequence to send. A byte, because only the low byte is echoed back. */
  #seq = 0;
  /** Sequence of the request still waiting for a reply, or null. */
  #outstanding: number | null = null;
  #serial: number | undefined;
  /** Set only while the discovery probe is in flight. */
  #probe: ((serial: number | undefined) => void) | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #openCallback: ((err?: Error) => void) | null = null;
  #closeCallback: (() => void) | null = null;

  constructor(opts: SolarmanV5PortOptions) {
    super();
    this.endpoint = { host: opts.host, port: opts.port };
    this.#timeoutMs = opts.timeoutMs;
    this.#configuredSerial = opts.loggerSerial;
    this.#createSocket = opts.createSocket ?? tcpSocket;
  }

  /** modbus-serial reads this before every transaction. */
  get isOpen(): boolean {
    return this.#openFlag;
  }

  /** The logger's serial as the logger itself reported it, once known. */
  get loggerSerial(): number | undefined {
    return this.#serial;
  }

  /**
   * Connect, then discover the logger serial before reporting success.
   *
   * The probe costs one round trip per connect — and connects are rare, while a
   * stale serial in the config polls a dead endpoint forever. So the reply
   * header wins over the configured value, always; the configured value is used
   * only if the probe gets no answer at all.
   */
  open(callback?: (err?: Error) => void): void {
    this.#openCallback = callback ?? null;
    this.#buffer = new Uint8Array(0);
    this.#outstanding = null;
    const socket = this.#createSocket({
      onConnect: () => this.#handleConnect(),
      onData: (chunk) => this.#handleData(chunk),
      onClose: () => this.#handleClose(),
      onError: (err) => this.#handleError(err),
    });
    this.#socket = socket;
    // The connect itself carries no deadline, so an unreachable stick would hang
    // until the OS gave up minutes later.
    this.#arm(() =>
      this.#failOpen(new Error(`connect to ${this.endpoint.host}:${this.endpoint.port} timed out`)),
    );
    socket.connect({ host: this.endpoint.host, port: this.endpoint.port });
  }

  /** Wrap one RTU frame in a V5 request and send it. */
  write(rtu: Uint8Array): void {
    if (!this.#openFlag || !this.#socket) {
      // The stick accepts exactly ONE TCP client and the Solarman cloud steals
      // the slot, so writing into a closed socket is routine, not exceptional:
      // the pending transaction times out and `ModbusTransport` reconnects.
      log.warn("solarman: dropping a write on a closed port");
      return;
    }
    const seq = this.#nextSeq();
    this.#outstanding = seq;
    this.#socket.write(encodeRequest({ serial: this.#serial ?? PROBE_SERIAL, seq, pdu: rtu }));
  }

  close(callback?: () => void): void {
    if (!this.#socket) {
      this.#openFlag = false;
      callback?.();
      return;
    }
    this.#closeCallback = callback ?? null;
    this.#socket.end();
  }

  destroy(callback?: () => void): void {
    this.#disarm();
    this.#openFlag = false;
    this.#socket?.destroy();
    callback?.();
  }

  /** Post-increment inside a byte: the logger echoes the low byte only. */
  #nextSeq(): number {
    const seq = this.#seq;
    this.#seq = (this.#seq + 1) & 0xff;
    return seq;
  }

  #arm(onTimeout: () => void): void {
    this.#disarm();
    this.#timer = setTimeout(onTimeout, this.#timeoutMs);
  }

  #disarm(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #handleConnect(): void {
    this.#probe = (serial) => this.#finishProbe(serial);
    this.#arm(() => this.#finishProbe(undefined));
    this.#socket?.write(
      encodeRequest({ serial: PROBE_SERIAL, seq: this.#nextSeq(), pdu: PROBE_PDU }),
    );
  }

  /**
   * The probe answered (or did not). A logger that says nothing is not
   * necessarily broken — some firmware ignores a serial-0 request outright — so
   * a configured serial is honoured here rather than failing the open.
   */
  #finishProbe(serial: number | undefined): void {
    this.#disarm();
    this.#probe = null;
    const resolved = serial ?? this.#configuredSerial;
    if (resolved === undefined) {
      this.#failOpen(
        new Error(
          `${this.endpoint.host}:${this.endpoint.port} did not answer the discovery probe and no logger serial ` +
            `is configured; set one from the sticker inside the dongle`,
        ),
      );
      return;
    }
    if (serial === undefined) {
      log.warn("solarman: discovery probe unanswered; falling back to the configured serial");
    } else if (this.#configuredSerial !== undefined && serial !== this.#configuredSerial) {
      log.warn(
        "solarman: configured logger serial {configured} is stale; the stick reports {real}",
        {
          configured: this.#configuredSerial,
          real: serial,
        },
      );
    }
    this.#serial = resolved;
    this.#openFlag = true;
    log.info("solarman: connected to {host}:{port}, logger serial {serial}", {
      host: this.endpoint.host,
      port: this.endpoint.port,
      serial: resolved,
    });
    this.#settleOpen(undefined);
  }

  #failOpen(err: Error): void {
    this.#disarm();
    this.#probe = null;
    this.#openFlag = false;
    this.#socket?.destroy();
    this.#settleOpen(err);
  }

  /** Call the open callback at most once, whichever way open ended. */
  #settleOpen(err: Error | undefined): void {
    const cb = this.#openCallback;
    this.#openCallback = null;
    cb?.(err);
  }

  #handleData(chunk: Uint8Array): void {
    this.#buffer = concat(this.#buffer, chunk);
    let frames: Uint8Array[];
    try {
      const split = splitFrames(this.#buffer);
      frames = split.frames;
      this.#buffer = split.rest;
    } catch (err) {
      // Desynchronised: scanning forward for the next 0xa5 would lock onto a
      // payload byte. Drop what we hold and let the next read start clean.
      log.warn("solarman: dropping a desynchronised read buffer: {reason}", {
        reason: err instanceof SolarmanFrameError ? err.reason : String(err),
      });
      this.#buffer = new Uint8Array(0);
      return;
    }
    for (const raw of frames) this.#handleFrame(raw);
  }

  #handleFrame(raw: Uint8Array): void {
    let frame;
    try {
      frame = decodeFrame(raw);
    } catch (err) {
      log.warn("solarman: dropping a malformed frame: {reason}", {
        reason: err instanceof SolarmanFrameError ? err.reason : String(err),
      });
      return;
    }
    if (this.#probe) {
      // Any reply at all names the logger — a reject names it just as well as a
      // real response, which is the whole trick.
      if (frame.kind !== "other") this.#probe(frame.serial);
      return;
    }
    if (frame.kind !== "response") {
      log.debug("solarman: dropping a non-response frame ({kind})", { kind: frame.kind });
      return;
    }
    if (frame.serial !== this.#serial) {
      log.warn("solarman: dropping a frame from logger {serial}", { serial: frame.serial });
      return;
    }
    if ((frame.seq & 0xff) !== this.#outstanding) {
      log.warn("solarman: dropping a reply for sequence {seq}, expected {expected}", {
        seq: frame.seq & 0xff,
        expected: this.#outstanding,
      });
      return;
    }
    // Cleared before emitting, so a duplicate reply cannot run modbus-serial's
    // transaction callback a second time.
    this.#outstanding = null;
    // A Buffer, not a Uint8Array: modbus-serial's parser calls `readUInt16LE` on
    // what it receives. CRC included — see the header on why nothing is stripped.
    this.emit("data", Buffer.from(frame.pdu));
  }

  #handleClose(): void {
    const wasOpen = this.#openFlag;
    this.#openFlag = false;
    this.#disarm();
    this.#probe = null;
    if (this.#openCallback) {
      this.#settleOpen(
        new Error(`${this.endpoint.host}:${this.endpoint.port} closed before the port opened`),
      );
    }
    const cb = this.#closeCallback;
    this.#closeCallback = null;
    cb?.();
    // Re-emitted so `ModbusTransport.getClient()` sees `isOpen === false` and
    // builds a fresh client on the next poll.
    if (wasOpen) this.emit("close");
  }

  #handleError(err: Error): void {
    if (this.#openCallback) {
      this.#failOpen(err);
      return;
    }
    this.#openFlag = false;
    this.emit("error", err);
  }
}
