import { describe, expect, test } from "bun:test";

import { checksum, decodeFrame, encodeRequest, splitFrames, SolarmanFrameError } from "./v5-frame";

/** Hex text (spaces optional) → bytes, so the golden vectors stay readable. */
const bytes = (hex: string): Uint8Array =>
  Uint8Array.from(
    hex
      .trim()
      .split(/\s+/)
      .map((b) => Number.parseInt(b, 16)),
  );

const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ");

/**
 * Captured live from the user's stick (logger serial 3168930341 = 0xBCE20A25,
 * firmware LSW3_32_5406_SS_04_00.00.00.0A). These vectors are the only
 * specification of V5 we have that is not someone's guess, so every structural
 * claim in the codec is anchored to them rather than to a document.
 */
const REQUEST =
  "a5 17 00 10 45 01 00 25 0a e2 bc 02 00 00 00 00 00 00 00 00 00 00 00 00 00 00 " +
  "01 03 00 03 00 06 35 c8 46 15";
const RESPONSE =
  "a5 1f 00 10 15 01 0d 25 0a e2 bc 02 01 bf 08 18 01 2c 00 00 00 31 34 90 69 " +
  "01 03 0c 32 35 31 30 32 33 34 35 37 38 00 00 47 07 ef 15";
/** The reply to a request that carried the WRONG logger serial. */
const STATUS =
  "a5 10 00 10 15 01 39 25 0a e2 bc 02 01 ab 0b 18 01 19 03 00 00 31 34 90 69 06 00 8e 15";
/**
 * The reply to a request the inverter would not answer — captured from register
 * address 60000, from address 9000, and from a 200-register read, all three
 * identical in shape. Status `05`, where the wrong-serial reject says `06`.
 */
const REJECT_UNANSWERED =
  "a5 10 00 10 15 02 6c 25 0a e2 bc 02 01 87 12 18 01 f6 09 00 00 32 34 90 69 05 00 88 15";
/**
 * An unsolicited frame the stick sends on an idle socket. Control code 0x4710
 * rather than 0x1510, and a one-byte payload — the only unprompted frame we have
 * actually observed, and it must never reach the Modbus parser.
 */
const HEARTBEAT = "a5 01 00 10 47 04 6f 25 0a e2 bc 00 98 15";
const REQUEST_PDU = "01 03 00 03 00 06 35 c8";
const RESPONSE_PDU = "01 03 0c 32 35 31 30 32 33 34 35 37 38 00 00 47 07";
const SERIAL = 0xbce20a25;

describe("checksum", () => {
  test("reproduces the byte the stick itself put on each captured frame", () => {
    for (const frame of [REQUEST, RESPONSE, STATUS]) {
      const buf = bytes(frame);
      expect(checksum(buf)).toBe(buf[buf.length - 2]!);
    }
  });

  test("wraps at a byte — the sum is masked, not left to overflow", () => {
    // Two frames whose covered bytes differ by exactly one must differ by one
    // modulo 256, whatever the absolute sums are.
    const a = encodeRequest({ serial: 0, seq: 0, pdu: bytes("01 03 00 00 00 01 00 00") });
    const b = encodeRequest({ serial: 0, seq: 0, pdu: bytes("01 03 00 00 01 01 00 00") });
    expect(checksum(a)).toBe((checksum(b) + 0xff) & 0xff);
    expect(checksum(a)).toBeLessThan(0x100);
  });
});

describe("encodeRequest", () => {
  test("reproduces the captured FC03 request byte for byte", () => {
    const frame = encodeRequest({ serial: SERIAL, seq: 1, pdu: bytes(REQUEST_PDU) });
    expect(hex(frame)).toBe(hex(bytes(REQUEST)));
  });

  test("length field counts the business field plus the PDU, never the envelope", () => {
    const frame = encodeRequest({ serial: SERIAL, seq: 1, pdu: bytes(REQUEST_PDU) });
    const payloadLength = frame[1]! | (frame[2]! << 8);
    expect(payloadLength).toBe(15 + 8);
    expect(frame.length).toBe(11 + payloadLength + 2);
  });

  test("serial 0 is a legal discovery request, not an omission", () => {
    const frame = encodeRequest({ serial: 0, seq: 7, pdu: bytes(REQUEST_PDU) });
    expect(Array.from(frame.slice(7, 11))).toEqual([0, 0, 0, 0]);
    expect(frame[5]).toBe(7);
  });

  test("a sequence past a byte still lands little-endian in both header bytes", () => {
    const frame = encodeRequest({ serial: SERIAL, seq: 0x0dff, pdu: bytes(REQUEST_PDU) });
    expect(frame[5]).toBe(0xff);
    expect(frame[6]).toBe(0x0d);
  });

  test("0xffffffff round-trips as an unsigned serial, not as -1", () => {
    const frame = encodeRequest({ serial: 0xffffffff, seq: 1, pdu: bytes(REQUEST_PDU) });
    expect(Array.from(frame.slice(7, 11))).toEqual([0xff, 0xff, 0xff, 0xff]);
  });

  test("an empty PDU still frames — the envelope does not depend on its contents", () => {
    const frame = encodeRequest({ serial: SERIAL, seq: 1, pdu: new Uint8Array(0) });
    expect(frame.length).toBe(11 + 15 + 2);
    expect(checksum(frame)).toBe(frame[frame.length - 2]!);
  });
});

describe("decodeFrame", () => {
  test("decodes the captured response, PDU intact including its CRC16", () => {
    const frame = decodeFrame(bytes(RESPONSE));
    expect(frame.kind).toBe("response");
    if (frame.kind !== "response") throw new Error("unreachable");
    expect(frame.serial).toBe(SERIAL);
    expect(frame.status).toBe(1);
    expect(hex(frame.pdu)).toBe(hex(bytes(RESPONSE_PDU)));
  });

  test("keeps the raw sequence word: only its LOW byte echoes the request", () => {
    const frame = decodeFrame(bytes(RESPONSE));
    if (frame.kind !== "response") throw new Error("unreachable");
    // The request carried seq 0x0001; the logger replied 0x0d01 — its own
    // counter in the high byte. Matching the whole word drops every reply.
    expect(frame.seq).toBe(0x0d01);
    expect(frame.seq & 0xff).toBe(1);
  });

  test("the wrong-serial reply is a status frame, and still carries the REAL serial", () => {
    const frame = decodeFrame(bytes(STATUS));
    expect(frame.kind).toBe("status");
    if (frame.kind !== "status") throw new Error("unreachable");
    // This is the whole auto-discovery mechanism: we asked with serial 1 and the
    // logger told us who it actually is in the header it replied with.
    expect(frame.serial).toBe(SERIAL);
    expect(hex(frame.payload)).toBe("06 00");
    // The status byte is what separates "wrong serial" from "the inverter would
    // not answer", and the sequence is what ties the reject to the request it
    // refuses — without both, a reject can only be dropped.
    expect(frame.status).toBe(0x06);
    expect(frame.seq & 0xff).toBe(0x01);
  });

  test("the unanswered-request reject carries status 05 and its own sequence", () => {
    const frame = decodeFrame(bytes(REJECT_UNANSWERED));
    expect(frame.kind).toBe("status");
    if (frame.kind !== "status") throw new Error("unreachable");
    expect(frame.serial).toBe(SERIAL);
    expect(frame.status).toBe(0x05);
    expect(frame.seq & 0xff).toBe(0x02);
  });

  test("a status frame with no payload at all reports status 0 rather than NaN", () => {
    const raw = bytes(STATUS);
    raw[1] = 14;
    const trimmed = raw.slice(0, 11 + 14 + 2);
    trimmed[trimmed.length - 1] = 0x15;
    trimmed[trimmed.length - 2] = checksum(trimmed);
    const frame = decodeFrame(trimmed);
    if (frame.kind !== "status") throw new Error("unreachable");
    expect(frame.status).toBe(0);
  });

  test("the captured heartbeat decodes as `other`, never as a reply", () => {
    // Golden vector, not a synthesised one: this is the frame that actually
    // arrives unbidden on a socket nobody is talking on.
    expect(decodeFrame(bytes(HEARTBEAT))).toEqual({ kind: "other", controlCode: 0x4710 });
  });

  test("a request frame decodes as `other`, tagged with its control code", () => {
    expect(decodeFrame(bytes(REQUEST))).toEqual({ kind: "other", controlCode: 0x4510 });
  });

  test("a heartbeat control code decodes as `other` rather than as a reply", () => {
    const raw = bytes(RESPONSE);
    raw[3] = 0x10;
    raw[4] = 0x47;
    raw[raw.length - 2] = checksum(raw);
    expect(decodeFrame(raw)).toEqual({ kind: "other", controlCode: 0x4710 });
  });

  describe("the response/status boundary", () => {
    /** A 0x1510 frame whose payload after the 14-byte business field is `n` bytes. */
    const replyWithPayload = (n: number): Uint8Array => {
      const head = bytes(RESPONSE).slice(0, 11 + 14);
      const frame = new Uint8Array(11 + 14 + n + 2);
      frame.set(head, 0);
      frame[1] = (14 + n) & 0xff;
      frame[2] = ((14 + n) >> 8) & 0xff;
      frame.fill(0x33, 11 + 14, 11 + 14 + n);
      frame[frame.length - 1] = 0x15;
      frame[frame.length - 2] = checksum(frame);
      return frame;
    };

    test("5 payload bytes is the shortest legal RTU frame (an exception reply) and decodes as one", () => {
      expect(decodeFrame(replyWithPayload(5)).kind).toBe("response");
    });

    test("4 payload bytes cannot be an RTU frame, so it is a status payload", () => {
      expect(decodeFrame(replyWithPayload(4)).kind).toBe("status");
    });

    test("the captured 2-byte `06 00` sits below that floor, as it must", () => {
      expect(decodeFrame(replyWithPayload(2)).kind).toBe("status");
    });

    test("an empty payload is a status frame, never a zero-length PDU", () => {
      const frame = decodeFrame(replyWithPayload(0));
      expect(frame.kind).toBe("status");
      if (frame.kind !== "status") throw new Error("unreachable");
      expect(frame.payload).toHaveLength(0);
    });
  });

  describe("refusals", () => {
    const reasonOf = (buf: Uint8Array): string => {
      try {
        decodeFrame(buf);
      } catch (err) {
        if (err instanceof SolarmanFrameError) return err.reason;
        throw err;
      }
      throw new Error("expected decodeFrame to throw");
    };

    test("a wrong start byte", () => {
      const raw = bytes(RESPONSE);
      raw[0] = 0xa6;
      expect(reasonOf(raw)).toBe("bad-start");
    });

    test("a wrong end byte", () => {
      const raw = bytes(RESPONSE);
      raw[raw.length - 1] = 0x16;
      expect(reasonOf(raw)).toBe("bad-end");
    });

    test("a corrupted checksum", () => {
      const raw = bytes(RESPONSE);
      raw[raw.length - 2] = raw[raw.length - 2]! ^ 0xff;
      expect(reasonOf(raw)).toBe("bad-checksum");
    });

    test("a corrupted payload byte is caught by the checksum, not silently decoded", () => {
      const raw = bytes(RESPONSE);
      raw[20] = raw[20]! ^ 0x01;
      expect(reasonOf(raw)).toBe("bad-checksum");
    });

    test("an empty buffer", () => {
      expect(reasonOf(new Uint8Array(0))).toBe("short");
    });

    test("a buffer shorter than the envelope", () => {
      expect(reasonOf(bytes(RESPONSE).slice(0, 10))).toBe("short");
    });

    test("a length field that overruns the buffer", () => {
      const raw = bytes(RESPONSE);
      raw[1] = 0xff;
      expect(reasonOf(raw)).toBe("short");
    });

    test("a 0x1510 frame whose length field is shorter than the business field", () => {
      const raw = bytes("a5 05 00 10 15 01 0d 25 0a e2 bc 02 01 00 00 00 15");
      raw[raw.length - 2] = checksum(raw);
      expect(reasonOf(raw)).toBe("short");
    });

    test("SolarmanFrameError is an Error with a stable name", () => {
      const err = new SolarmanFrameError("bad-end", "nope");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("SolarmanFrameError");
      expect(err.reason).toBe("bad-end");
    });
  });
});

describe("splitFrames", () => {
  const concat = (...parts: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };

  test("an empty buffer yields nothing and keeps nothing", () => {
    const { frames, rest } = splitFrames(new Uint8Array(0));
    expect(frames).toEqual([]);
    expect(rest).toHaveLength(0);
  });

  test("one whole frame is taken and nothing is left over", () => {
    const { frames, rest } = splitFrames(bytes(RESPONSE));
    expect(frames.map(hex)).toEqual([hex(bytes(RESPONSE))]);
    expect(rest).toHaveLength(0);
  });

  test("two frames arriving in one TCP read are both taken", () => {
    const { frames, rest } = splitFrames(concat(bytes(RESPONSE), bytes(STATUS)));
    expect(frames.map(hex)).toEqual([hex(bytes(RESPONSE)), hex(bytes(STATUS))]);
    expect(rest).toHaveLength(0);
  });

  test("a frame split across two reads reassembles", () => {
    const whole = bytes(RESPONSE);
    const first = splitFrames(whole.slice(0, 20));
    expect(first.frames).toEqual([]);
    expect(first.rest).toHaveLength(20);
    const second = splitFrames(concat(first.rest, whole.slice(20)));
    expect(second.frames.map(hex)).toEqual([hex(whole)]);
    expect(second.rest).toHaveLength(0);
  });

  test("a whole frame followed by a partial one yields the first and keeps the tail", () => {
    const tail = bytes(STATUS).slice(0, 6);
    const { frames, rest } = splitFrames(concat(bytes(RESPONSE), tail));
    expect(frames).toHaveLength(1);
    expect(hex(rest)).toBe(hex(tail));
  });

  test("fewer bytes than the length prefix itself is kept, not guessed at", () => {
    const { frames, rest } = splitFrames(bytes("a5 1f"));
    expect(frames).toEqual([]);
    expect(rest).toHaveLength(2);
  });

  test("a bad checksum is still framed — splitting is length-prefixed, validating is decode's job", () => {
    const raw = bytes(RESPONSE);
    raw[raw.length - 2] = raw[raw.length - 2]! ^ 0xff;
    const { frames, rest } = splitFrames(raw);
    expect(frames).toHaveLength(1);
    expect(rest).toHaveLength(0);
    expect(() => decodeFrame(frames[0]!)).toThrow(SolarmanFrameError);
  });

  test("a desynchronised stream refuses rather than hunting for a start byte", () => {
    // Resyncing by scanning for 0xa5 would happily lock onto a payload byte; the
    // caller's only safe move is to drop the buffer, so say so loudly.
    expect(() => splitFrames(concat(bytes("00 00"), bytes(RESPONSE)))).toThrow(SolarmanFrameError);
  });

  test("frames parsed BEFORE the desync ride along on the error", () => {
    // The refusal is about the bytes that follow, not about the frames already
    // taken cleanly off the front. Dropping those costs the transaction one of
    // them answers its entire timeout, for a fault in a later byte.
    const err = (() => {
      try {
        splitFrames(concat(bytes(RESPONSE), bytes("00 00 00")));
        return undefined;
      } catch (e) {
        return e as SolarmanFrameError;
      }
    })();
    expect(err).toBeInstanceOf(SolarmanFrameError);
    expect(err!.reason).toBe("bad-start");
    expect(err!.frames.map(hex)).toEqual([hex(bytes(RESPONSE))]);
  });

  test("a desync at offset zero carries no salvage, and claims none", () => {
    const err = (() => {
      try {
        splitFrames(concat(bytes("00 00 00"), bytes(RESPONSE)));
        return undefined;
      } catch (e) {
        return e as SolarmanFrameError;
      }
    })();
    // Still no scanning forward: the bytes after a stray byte cannot be trusted
    // to be a frame boundary just because they look like one.
    expect(err!.frames).toEqual([]);
  });

  test("every other frame error carries an empty salvage list", () => {
    const short = (() => {
      try {
        decodeFrame(bytes("a5 01"));
        return undefined;
      } catch (e) {
        return e as SolarmanFrameError;
      }
    })();
    expect(short!.frames).toEqual([]);
  });

  test("the returned rest is a copy — mutating the input cannot corrupt it", () => {
    const partial = bytes(RESPONSE).slice(0, 20);
    const { rest } = splitFrames(partial);
    partial[0] = 0;
    expect(rest[0]).toBe(0xa5);
  });
});
