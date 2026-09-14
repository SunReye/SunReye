/**
 * The Solarman V5 wire format — pure codec, zero I/O.
 *
 * A Solarman logging stick (LSW-3 / LSE-3, the WiFi dongle that ships in the box
 * with most Deye/Sunsynk/SolarMAN-badged inverters) does NOT speak Modbus TCP on
 * port 8899. It speaks a proprietary envelope of its own with a plain Modbus RTU
 * PDU — CRC and all — carried inside it. So this is a FRAMING, not a device kind:
 * unwrap the envelope and the register map, the read planner and the atomic
 * compute groups above it are unchanged.
 *
 * Every structural claim below was captured from a live stick (logger serial
 * 3168930341, firmware LSW3_32_5406_SS_04_00.00.00.0A) rather than taken from a
 * document, and the golden vectors in the test file are those captures. Where
 * the published reverse-engineering notes and the stick disagreed, the stick
 * won — most consequentially about the sequence number (see {@link decodeFrame}).
 */

/** Frame delimiters. Every V5 frame starts 0xA5 and ends 0x15. */
const START = 0xa5;
const END = 0x15;

/**
 * Bytes before the payload: start + uint16 length + uint16 control + uint16
 * sequence + uint32 logger serial.
 */
const HEADER = 11;

/** Bytes after the payload: the checksum and the end delimiter. */
const TRAILER = 2;

/** Control codes, uint16 LE. A request is 0x4510; its reply is 0x1510. */
const CONTROL_REQUEST = 0x4510;
const CONTROL_RESPONSE = 0x1510;

/**
 * The request's business field: frame type, sensor type, and three uptime
 * counters we have nothing to say about, so they go out as zeros — which is
 * exactly what the stick's own app sends and what it answered.
 */
const REQUEST_BUSINESS = 15;

/**
 * The reply's business field is ONE BYTE SHORTER than the request's: the sensor
 * type is absent and a single status byte takes its place. Mirroring the request
 * layout here shifts every field by one and silently decodes garbage, so the two
 * lengths are named separately.
 */
const RESPONSE_BUSINESS = 14;

/**
 * The shortest thing that can be a Modbus RTU frame: unit id, function code, one
 * byte of body and the CRC16 — an exception reply. This is the boundary that
 * separates a real reply from a status/reject payload, because both arrive under
 * control code 0x1510 and are otherwise indistinguishable. The captured reject
 * payload is `06 00`, two bytes: handing that to modbus-serial as a PDU would
 * have it fail a CRC check on noise instead of us simply dropping it.
 */
const MIN_RTU_FRAME = 5;

/** Why a buffer is not a frame. Each one has a different remedy, so each is named. */
export type SolarmanFrameReason =
  /** Does not begin 0xA5 — the stream is desynchronised; drop the buffer. */
  | "bad-start"
  /** Does not end 0x15 at the length the prefix promised — same, but louder. */
  | "bad-end"
  /** Framed correctly and the bytes are corrupt; drop this frame only. */
  | "bad-checksum"
  /** Fewer bytes than the envelope or the length prefix requires; wait for more. */
  | "short";

/** A buffer that is not a well-formed V5 frame, tagged with why. */
export class SolarmanFrameError extends Error {
  readonly reason: SolarmanFrameReason;

  constructor(reason: SolarmanFrameReason, message: string) {
    super(message);
    this.name = "SolarmanFrameError";
    this.reason = reason;
  }
}

/**
 * The V5 checksum: the low byte of the sum of everything between the start
 * delimiter and the checksum itself — i.e. `frame[1 .. length-3]` inclusive.
 * Both delimiters and the checksum byte are excluded.
 *
 * Takes the WHOLE frame rather than the covered slice so callers cannot get the
 * bounds wrong; verifying is `checksum(frame) === frame.at(-2)`.
 */
export function checksum(frame: Uint8Array): number {
  let sum = 0;
  for (let i = 1; i <= frame.length - 3; i++) sum += frame[i]!;
  return sum & 0xff;
}

/** A request to wrap: whose logger, which sequence, and the RTU PDU to carry. */
export interface EncodeRequestInput {
  /**
   * The logger's serial as a uint32. A stick answers a request carrying the
   * wrong serial with a status/reject frame — which still names the real serial
   * in its header, and that is how {@link decodeFrame} makes discovery possible.
   */
  serial: number;
  /** Sequence number; only the low byte is echoed back (see {@link decodeFrame}). */
  seq: number;
  /** A complete Modbus RTU PDU including its trailing CRC16. */
  pdu: Uint8Array;
}

/**
 * Wrap an RTU PDU in a V5 request envelope.
 *
 * The three uptime counters in the business field go out as zeros: they are the
 * logger's own statistics, the stick does not check them, and inventing values
 * would only make the capture harder to compare against.
 */
export function encodeRequest({ serial, seq, pdu }: EncodeRequestInput): Uint8Array {
  const payloadLength = REQUEST_BUSINESS + pdu.length;
  const frame = new Uint8Array(HEADER + payloadLength + TRAILER);
  const view = new DataView(frame.buffer);
  frame[0] = START;
  view.setUint16(1, payloadLength, true);
  view.setUint16(3, CONTROL_REQUEST, true);
  view.setUint16(5, seq & 0xffff, true);
  // `>>> 0` keeps 0xFFFFFFFF an unsigned serial rather than -1.
  view.setUint32(7, serial >>> 0, true);
  // Business field: frame type 0x02 (solar inverter); sensor type and the three
  // counters stay zero.
  frame[HEADER] = 0x02;
  frame.set(pdu, HEADER + REQUEST_BUSINESS);
  frame[frame.length - 1] = END;
  frame[frame.length - 2] = checksum(frame);
  return frame;
}

/**
 * A decoded V5 frame.
 *
 * `response` and `status` share a control code and differ only in whether the
 * payload can be an RTU frame at all; `other` is every control code we do not
 * act on (the logger's own heartbeats, and our own requests if one is ever fed
 * back through here).
 */
export type SolarmanFrame =
  | {
      kind: "response";
      /** The logger's real serial, from the reply header. */
      serial: number;
      /**
       * The RAW sequence word. Only its low byte echoes the request; the high
       * byte is the logger's own counter, so callers must match on
       * `seq & 0xff`.
       */
      seq: number;
      /** Business status byte; 0x01 on every healthy reply we captured. */
      status: number;
      /** The inner Modbus RTU frame, CRC16 included, exactly as it arrived. */
      pdu: Uint8Array;
    }
  | {
      kind: "status";
      /**
       * The logger's real serial — present even when WE asked with the wrong
       * one, which is the entire auto-discovery mechanism.
       */
      serial: number;
      /**
       * The RAW sequence word, same caveat as on a response: match on
       * `seq & 0xff`. A reject echoes the sequence of the request it refuses,
       * which is the only thing that ties it to an outstanding transaction —
       * without it a reject can only ever be dropped, and the transaction it
       * answers burns its full timeout.
       */
      seq: number;
      /**
       * The first payload byte, the V5 status code. Measured on the captured
       * stick: `05` means the inverter did not answer this request (an address
       * outside its map, or a read over the 125-register cap), `06` means the
       * request named the wrong or an unknown logger serial. Zero when the
       * payload is empty, which no stick has been seen to send.
       */
      status: number;
      /** Whatever sat where a PDU would: `06 00` on a wrong-serial reject. */
      payload: Uint8Array;
    }
  | { kind: "other"; controlCode: number };

/** Validate the envelope of one complete frame, or throw. */
function assertEnvelope(buf: Uint8Array): number {
  if (buf.length < HEADER + TRAILER) {
    throw new SolarmanFrameError("short", `frame is ${buf.length} bytes, envelope needs 13`);
  }
  if (buf[0] !== START) {
    throw new SolarmanFrameError("bad-start", `expected 0xa5 start byte, got 0x${byte(buf[0])}`);
  }
  const payloadLength = buf[1]! | (buf[2]! << 8);
  const total = HEADER + payloadLength + TRAILER;
  if (buf.length < total) {
    throw new SolarmanFrameError(
      "short",
      `length prefix promises ${total} bytes, buffer holds ${buf.length}`,
    );
  }
  if (buf[total - 1] !== END) {
    throw new SolarmanFrameError(
      "bad-end",
      `expected 0x15 end byte at ${total - 1}, got 0x${byte(buf[total - 1])}`,
    );
  }
  const expected = checksum(buf.subarray(0, total));
  if (buf[total - 2] !== expected) {
    throw new SolarmanFrameError(
      "bad-checksum",
      `checksum 0x${byte(buf[total - 2])}, computed 0x${byte(expected)}`,
    );
  }
  return payloadLength;
}

const byte = (b: number | undefined): string => (b ?? 0).toString(16).padStart(2, "0");

/**
 * Decode one complete V5 frame.
 *
 * The frame must already be complete — use {@link splitFrames} on a socket
 * stream first. Trailing bytes past the length prefix are ignored rather than
 * refused, so a caller that has not split is merely wasteful, not wrong.
 */
export function decodeFrame(buf: Uint8Array): SolarmanFrame {
  const payloadLength = assertEnvelope(buf);
  const controlCode = buf[3]! | (buf[4]! << 8);
  if (controlCode !== CONTROL_RESPONSE) return { kind: "other", controlCode };
  if (payloadLength < RESPONSE_BUSINESS) {
    throw new SolarmanFrameError(
      "short",
      `reply payload is ${payloadLength} bytes, business field needs ${RESPONSE_BUSINESS}`,
    );
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const serial = view.getUint32(7, true);
  const payload = buf.slice(HEADER + RESPONSE_BUSINESS, HEADER + payloadLength);
  // Too short to be an RTU frame ⇒ this is a status/reject payload, not a PDU.
  if (payload.length < MIN_RTU_FRAME) {
    return {
      kind: "status",
      serial,
      seq: view.getUint16(5, true),
      status: payload[0] ?? 0,
      payload,
    };
  }
  return {
    kind: "response",
    serial,
    seq: view.getUint16(5, true),
    status: buf[HEADER + 1]!,
    pdu: payload,
  };
}

/**
 * Split a socket buffer into complete frames plus the leftover tail.
 *
 * TCP gives no message boundaries: one read can carry half a frame, two frames,
 * or a frame and a half. Framing is purely length-prefixed here — a frame with a
 * broken checksum is still SPLIT correctly (its length prefix is intact) and is
 * rejected later by {@link decodeFrame}, which keeps one corrupt frame from
 * desynchronising the rest of the stream.
 *
 * A buffer that does not START on a frame boundary throws `bad-start`: scanning
 * forward for the next 0xA5 would cheerfully lock onto a payload byte and
 * produce plausible nonsense, so the only safe response is for the caller to
 * drop its buffer and let the reconnect handle it.
 */
export function splitFrames(buf: Uint8Array): { frames: Uint8Array[]; rest: Uint8Array } {
  const frames: Uint8Array[] = [];
  let at = 0;
  // Three bytes is the minimum that can state a length; fewer and the tail is
  // simply kept until the next read.
  while (buf.length - at >= 3) {
    if (buf[at] !== START) {
      throw new SolarmanFrameError(
        "bad-start",
        `stream desynchronised at offset ${at}: expected 0xa5, got 0x${byte(buf[at])}`,
      );
    }
    const total = HEADER + (buf[at + 1]! | (buf[at + 2]! << 8)) + TRAILER;
    if (buf.length - at < total) break;
    frames.push(buf.slice(at, at + total));
    at += total;
  }
  return { frames, rest: buf.slice(at) };
}
