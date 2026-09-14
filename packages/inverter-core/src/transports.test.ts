import { describe, expect, test } from "bun:test";

import { MODBUS_TRANSPORTS, narrowTransport } from "./transports";

describe("MODBUS_TRANSPORTS", () => {
  test("names every framing the Modbus client implements", () => {
    expect([...MODBUS_TRANSPORTS]).toEqual(["tcp", "rtu-over-tcp", "solarman-v5"]);
  });

  test("tcp is FIRST, because it is what every layer degrades to", () => {
    expect(MODBUS_TRANSPORTS[0]).toBe("tcp");
  });
});

describe("narrowTransport", () => {
  test("every known framing survives", () => {
    for (const t of MODBUS_TRANSPORTS) expect(narrowTransport(t)).toBe(t);
  });

  test("an unknown framing degrades to tcp rather than leaving nothing pollable", () => {
    // `connections.params` is jsonb with no CHECK, and the archive import, the
    // bucket replay and the in-place 1.2.0 upgrade all write it without passing
    // an HTTP edge. A value none of them guarded must not make a device
    // unbuildable — that is a plant gone quiet with no error anyone reads.
    expect(narrowTransport("ascii")).toBe("tcp");
    expect(narrowTransport("")).toBe("tcp");
  });

  test("a non-string is narrowed too, not trusted for having the right shape", () => {
    expect(narrowTransport(undefined)).toBe("tcp");
    expect(narrowTransport(null)).toBe("tcp");
    expect(narrowTransport(7)).toBe("tcp");
    expect(narrowTransport({ transport: "solarman-v5" })).toBe("tcp");
  });

  test("matching is exact — a near miss is not a framing", () => {
    expect(narrowTransport("solarman")).toBe("tcp");
    expect(narrowTransport("SOLARMAN-V5")).toBe("tcp");
    expect(narrowTransport(" tcp ")).toBe("tcp");
  });
});
