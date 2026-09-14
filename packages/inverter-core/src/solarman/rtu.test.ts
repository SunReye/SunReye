import { describe, expect, test } from "bun:test";

import { crc16, rtuException } from "./rtu";

const bytes = (hex: string): Uint8Array =>
  Uint8Array.from(
    hex
      .trim()
      .split(/\s+/)
      .map((b) => Number.parseInt(b, 16)),
  );

const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ");

describe("crc16", () => {
  /**
   * Both vectors are lifted out of the live captures rather than out of a CRC
   * tutorial: the request the stick accepted and the reply it sent back. A CRC
   * that reproduces those is the same CRC modbus-serial checks with, which is
   * the only property that matters here — a synthesized frame whose CRC
   * disagrees is thrown away as "CRC error" instead of becoming a modbusCode.
   */
  test("reproduces the CRC of the captured FC03 request", () => {
    expect(crc16(bytes("01 03 00 03 00 06"))).toBe(0xc835);
  });

  test("reproduces the CRC of the captured FC03 reply", () => {
    expect(crc16(bytes("01 03 0c 32 35 31 30 32 33 34 35 37 38 00 00"))).toBe(0x0747);
  });

  test("an empty buffer is the seed, untouched", () => {
    expect(crc16(new Uint8Array(0))).toBe(0xffff);
  });
});

describe("rtuException", () => {
  test("builds the five-byte illegal-data-address reply for unit 1, FC03", () => {
    expect(hex(rtuException(1, 0x03, 0x02))).toBe("01 83 02 c0 f1");
  });

  test("the function code is the request's, raised by 0x80 — FC16 here", () => {
    expect(hex(rtuException(5, 0x10, 0x02))).toBe("05 90 02 8c 00");
  });

  test("carries the unit id it was given rather than a hardcoded 1", () => {
    expect(hex(rtuException(0x17, 0x03, 0x02))).toBe("17 83 02 21 35");
  });

  test("any exception code is representable, not just illegal-data-address", () => {
    expect(hex(rtuException(1, 0x03, 0x0a))).toBe("01 83 0a c1 37");
    expect(hex(rtuException(1, 0x03, 0x0b))).toBe("01 83 0b 00 f7");
  });

  test("is exactly the 5 bytes modbus-serial demands of a reply", () => {
    // Shorter than 5 and `_onReceive` refuses it as a length error before it
    // ever looks at the function code.
    expect(rtuException(1, 0x03, 0x02)).toHaveLength(5);
  });

  test("a function code that already has 0x80 set is not raised twice", () => {
    expect(hex(rtuException(1, 0x83, 0x02))).toBe("01 83 02 c0 f1");
  });
});
