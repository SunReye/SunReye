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

import { rtuException } from "./rtu";
import { decodeFrame, encodeRequest, splitFrames, SolarmanFrameError } from "./v5-frame";

const log = getLogger(["inverter-core", "solarman"]);

/**
 * How a V5 reject is reported to modbus-serial, and why each mapping is the
 * faithful one.
 *
 * A Solarman logger NEVER forwards a real Modbus exception PDU. On a live Deye
 * every in-range read was answered with data — singles at 200/300/400/500/700/
 * 800/1000, blocks 0..119, 100..119, 600..719, 690..710 — and the only requests
 * that came back refused came back as a V5 reject, never as `01 83 02`. So the
 * exception the transport above needs has to be MADE here or it does not exist,
 * and a dropped reject leaves the transaction to burn its whole timeout.
 *
 * This is a translation, not a pretence: {@link SolarmanV5Port} reports the raw
 * V5 status alongside every frame it synthesizes, so the logs still say what the
 * wire actually carried.
 */
const EXCEPTION_FOR_STATUS: Readonly<Record<number, { code: number; meaning: string }>> = {
  /**
   * Measured: the inverter did not answer this request. Produced by register
   * address 60000, by address 9000, and by a 200-register read (over the
   * 125-register Modbus cap) — i.e. exactly the cases a device that DID speak
   * Modbus would answer with exception 2. Mapping it there is what lets
   * `isIllegalDataAddress` in `modbus-transport.ts` split the spanning block,
   * remember the split, and carry on.
   */
  0x05: { code: 0x02, meaning: "the inverter did not answer this request" },
  /**
   * Measured: the request named the wrong or an unknown logger serial (sent as
   * 1, 0, 0xFFFFFFFF and serial+1 — identical every time). This is an ADDRESSING
   * failure, not a register one. Reporting it as exception 2 would have the
   * transport quietly amputate registers from the read plan because a serial is
   * stale, so it maps to 10 — gateway path unavailable, which is literally what
   * a logging stick that cannot route the request is saying.
   */
  0x06: { code: 0x0a, meaning: "wrong or unknown logger serial" },
};

/**
 * Any status we have never seen. 11 — gateway target device failed to respond —
 * because the one thing we do know is that the gateway refused and the inverter
 * said nothing. Never 2: only the one measured meaning earns the split.
 */
const EXCEPTION_UNKNOWN = { code: 0x0b, meaning: "unrecognised V5 status" } as const;

/** What a synthesized exception needs that only the REQUEST can supply. */
interface Outstanding {
  /** Low byte of the sequence; the logger echoes no more than that. */
  seq: number;
  /** Unit id from the request's own RTU frame — not necessarily 1. */
  unitId: number;
  /** Function code as sent; the exception reply is this with 0x80 set. */
  fn: number;
  /**
   * The RTU frame exactly as it was handed to us, kept so a transient refusal
   * can be asked again byte-for-byte rather than guessed at.
   */
  rtu: Uint8Array;
  /** Whether this request has already spent its one retry. */
  retried: boolean;
}

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
  /** The request still waiting for a reply, or null. */
  #outstanding: Outstanding | null = null;
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
      // Writing into a closed socket is routine, not exceptional: the stick
      // hangs up freely (a reset under load, its own reboot, the network), and
      // the pending transaction then times out and `ModbusTransport` reconnects.
      //
      // Measured on the live stick, correcting an earlier claim that stood here:
      // a SECOND TCP client does NOT evict the first. Two concurrent
      // `ModbusTransport` clients each read all 99 metrics (3096/2949/3209 ms
      // and 3196/2950/3209 ms, against 1441 ms for a single client) — the stick
      // serialises them on the shared RS485 bus instead. So the Solarman cloud
      // is not stealing a slot from us; reconnect handling is here because
      // sockets die, not because we are being evicted.
      log.warn("solarman: dropping a write on a closed port");
      return;
    }
    this.#send(Uint8Array.from(rtu), false);
  }

  /**
   * Put one RTU frame on the wire and remember what it will take to answer it.
   *
   * The unit id and function code are remembered HERE because a reject frame
   * carries no PDU at all: without them the exception reply it is translated
   * into could not be addressed to the transaction it answers. The frame itself
   * is kept for the same reason a retry needs it — the request is the only copy.
   *
   * Every attempt gets a FRESH sequence, retries included, so a late answer to
   * the attempt that was already refused stays recognisable as stale instead of
   * being mistaken for this one's.
   */
  #send(rtu: Uint8Array, retried: boolean): void {
    const seq = this.#nextSeq();
    this.#outstanding = { seq, unitId: rtu[0] ?? 0, fn: rtu[1] ?? 0, rtu, retried };
    this.#socket?.write(encodeRequest({ serial: this.#serial ?? PROBE_SERIAL, seq, pdu: rtu }));
  }

  /**
   * Hang up.
   *
   * The disarm is not housekeeping — it is the whole correctness of closing
   * mid-connect. `ModbusTransport.getClient()` races the entire connect against
   * a deadline of its own, which is NOT the discovery probe's deadline, and on
   * losing that race it closes a port whose probe is still outstanding. A timer
   * left running then fires on a closed port, falls back to the configured
   * serial and sets `isOpen` — after which every poll writes into a socket
   * nobody is reading, and the close callback never ran. `#handleClose` disarms
   * too, but only once the socket reports its close, which for a real
   * `net.Socket` is some time after `end()` and may be never.
   */
  close(callback?: () => void): void {
    this.#disarm();
    this.#probe = null;
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
    if (frame.kind === "status") {
      this.#handleReject(frame);
      return;
    }
    if (frame.kind !== "response") {
      // The one unsolicited frame we have actually observed — the stick's
      // heartbeat, control code 0x4710 — lands here and must stay a silent drop:
      // it answers nothing, so there is no transaction for it to fail.
      log.debug("solarman: dropping a non-response frame ({kind})", { kind: frame.kind });
      return;
    }
    this.#handleResponse(frame);
  }

  /** A frame carrying a real PDU: hand it to modbus-serial if it is ours. */
  #handleResponse(frame: { serial: number; seq: number; pdu: Uint8Array }): void {
    if (frame.serial !== this.#serial) {
      log.warn("solarman: dropping a frame from logger {serial}", { serial: frame.serial });
      return;
    }
    if ((frame.seq & 0xff) !== this.#outstanding?.seq) {
      log.warn("solarman: dropping a reply for sequence {seq}, expected {expected}", {
        seq: frame.seq & 0xff,
        expected: this.#outstanding?.seq,
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

  /**
   * Turn a reject that answers the outstanding request into a failure
   * modbus-serial can see.
   *
   * The serial in the header is NOT checked against ours here, unlike on a real
   * reply: a `06` reject says the serial we asked with is wrong, so demanding a
   * match would drop the single frame that explains the problem. One TCP socket
   * is one logger, so the header is the truth either way.
   *
   * Emitting `"reject"` before `"data"` puts the real cause in front of a
   * listener before modbus-serial turns the synthesized frame into its own
   * generic exception message. `"reject"` rather than `"error"` on purpose:
   * modbus-serial forwards a port `"error"` onto the client, where an absent
   * listener would take the process down.
   */
  #handleReject(frame: { serial: number; seq: number; status: number }): void {
    const pending = this.#outstanding;
    if (!pending || (frame.seq & 0xff) !== pending.seq) {
      // Nothing outstanding, or a reject for a transaction that already
      // settled: failing the request currently in flight would blame it for
      // someone else's refusal.
      log.debug("solarman: dropping an unsolicited reject (V5 status {status})", {
        status: frame.status,
      });
      return;
    }
    if (this.#retryTransient(frame.status, pending)) return;
    // Cleared before emitting, so a duplicate reject — or a late real reply for
    // the same sequence — cannot run the transaction callback a second time.
    this.#outstanding = null;
    const { code, meaning } = EXCEPTION_FOR_STATUS[frame.status] ?? EXCEPTION_UNKNOWN;
    const status = `0x${frame.status.toString(16).padStart(2, "0")}`;
    const message =
      `solarman: logger ${frame.serial} rejected the request with V5 status ${status} ` +
      `(${meaning}); reported to Modbus as exception ${code}`;
    // Warn, not debug: for status 0x06 this is the only place the operator is
    // told that the configured serial is wrong, and for 0x05 it is the record of
    // which register the profile declares that this inverter will not serve.
    log.warn(message);
    this.emit("reject", new Error(message));
    this.emit("data", Buffer.from(rtuException(pending.unitId, pending.fn, code)));
  }

  /**
   * Ask a `05`-refused request ONE more time, and say whether that happened.
   *
   * V5 status `05` is ambiguous in a way that matters more than any other
   * mapping in this file. In the stick's own measured behaviour it means "the
   * inverter did not answer this request" — which is as true of a
   * logger-to-inverter RS485 round trip that timed out under load (TRANSIENT) as
   * of an address the inverter will never serve (STRUCTURAL). Nothing else on
   * the wire separates them.
   *
   * The costs are not symmetric. The structural reading feeds
   * `ModbusTransport.narrow()`, whose splice of the read plan and `degraded`
   * flag are PERMANENT — `this.blocks` is built once, in the constructor, and
   * nothing ever restores it. So believing a transient refusal splits an atomic
   * compute group and marks every later sample degraded for the life of the
   * process, from one busy moment. And busy moments are expected here: 96-215 ms
   * per round trip, 3.2 s for a full poll under cloud contention.
   *
   * Asking again is the cheapest honest discriminator, and effectively the only
   * one — a condition that clears between two round trips was transient, and one
   * that does not is structural enough to act on. Answered on retry ⇒ serve the
   * data; refused twice ⇒ exception 2, and the split-and-remember fallback (also
   * the safety net for gap-merged blocks) still gets its signal.
   *
   * One retry, not more: the transaction's deadline is modbus-serial's, and a
   * genuinely out-of-map register is read once per poll forever until the plan
   * is narrowed, so an unbounded retry would trade a permanent amputation for a
   * permanent doubling of every poll.
   *
   * Only `05` qualifies. A `06` says the logger serial we asked with is wrong,
   * which cannot change between two round trips; retrying it would buy a second
   * identical refusal.
   */
  #retryTransient(status: number, pending: Outstanding): boolean {
    if (status !== 0x05 || pending.retried) return false;
    // No socket to ask on: fail the transaction now rather than leave it waiting
    // on a request that never went out.
    if (!this.#openFlag || !this.#socket) return false;
    log.debug(
      "solarman: V5 status 0x05 on unit {unitId} fn {fn}; asking once more before " +
        "reporting it as an address the inverter will not serve",
      { unitId: pending.unitId, fn: pending.fn },
    );
    this.#send(pending.rtu, true);
    return true;
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

  /**
   * A socket error. During the connect it fails the open; afterwards it is a
   * CLOSE, and deliberately not an `"error"` event.
   *
   * `ModbusRTU.open()` registers its own `_onError` on the port it was given and
   * re-emits the error on the CLIENT (`modbus-serial/index.js:629`), where
   * nothing in this codebase listens — an unhandled `EventEmitter` "error" is a
   * thrown exception, and the server installs no `uncaughtException` handler, so
   * one peer reset would take the whole poller down. modbus-serial's own TCP
   * ports never reach that path (`ports/tcpport.js:157` swallows a socket error
   * into its callback), which is why this port is the first that can, and why a
   * bare `"error"` must never leave it once it is open.
   *
   * And a reset is the ROUTINE case here: the stick serialises clients on one
   * RS485 bus and hangs up freely under load. So it is routed through the same
   * path a FIN takes — `isOpen` goes false, `"close"` is re-emitted, and
   * `ModbusTransport.getClient()` builds a fresh client on the next poll. The
   * in-flight transaction is left to modbus-serial's own timeout, which owns it.
   * The cause is still reported, on `"port-error"`: a name no library listens
   * for, so an absent listener costs a diagnostic line rather than the process.
   */
  #handleError(err: Error): void {
    if (this.#openCallback) {
      this.#failOpen(err);
      return;
    }
    log.warn("solarman: socket error on an open port, closing for a clean reconnect: {message}", {
      message: err.message,
    });
    this.emit("port-error", err);
    // Before destroy(), so the "close" re-emit still sees a port that was open;
    // a second #handleClose from the socket's own close event is a no-op.
    this.#handleClose();
    this.#socket?.destroy();
  }
}
