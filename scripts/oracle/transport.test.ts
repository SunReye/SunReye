import { beforeAll, describe, expect, test } from "bun:test";

import { buildTransportCorpus, runScenario, SCENARIOS, type TransportCase } from "./transport";

/**
 * Hand-derived frames (Modbus spec layout; CRC16 and V5 checksum computed independently with python).
 * The first transaction of a client has id 1.
 */
const MBAP = {
  read: "000100000006" + "010301f40005",
  readUnit0: "000100000006" + "000301f40005",
  write: "000100000009" + "011001f80001020095",
};

const SOLARMAN_PROBE = "a51700104500000000000002000000000000000000000000000001030003000635c87815";
const SOLARMAN_READ_SEQ1 =
  "a5170010450100250ae2bc020000000000000000000000000000010301f40005c5c7c615";

let built: Awaited<ReturnType<typeof buildTransportCorpus>>;
let cases: Map<string, TransportCase>;

beforeAll(async () => {
  built = await buildTransportCorpus();
  cases = new Map(
    String(built["transport.ndjson"])
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as TransportCase)
      .map((row) => [row.case, row] as const),
  );
}, 120_000);

const corpus = async (): Promise<Map<string, TransportCase>> => cases;

const tx = (c: TransportCase): string[] =>
  c.exchanges.flatMap((e) => (e.dir === "tx" ? [e.hex] : []));

describe("the transport corpus", () => {
  test("is byte-identical when built twice", async () => {
    const again = await buildTransportCorpus();
    expect(again["transport.ndjson"]).toBe(built["transport.ndjson"]);
  }, 120_000);

  // A reply later than every client timer stands in for a stalled event loop under load.
  // Concurrent on purpose: more load, and the suite pays the slowest scenario, not their sum.
  // Cloned on return: a recording that still changes after it is handed over is not one.
  test("every scenario records the same case when every reply is late", async () => {
    const late = await Promise.all(
      SCENARIOS.map(async (s) => structuredClone(await runScenario(s, { replyDelayMs: 400 }))),
    );
    expect(late).toEqual(late.map((c) => cases.get(c.case)));
    expect(late.map((c) => c.case)).toEqual([...cases.keys()]);
  }, 120_000);

  test("covers all three framings at unit id 0 and unit id 1", async () => {
    const cases = [...(await corpus()).values()];
    for (const framing of ["tcp", "rtu-over-tcp", "solarman-v5"]) {
      const units = new Set(cases.filter((c) => c.framing === framing).map((c) => c.unitId));
      expect([...units].sort()).toEqual([0, 1]);
    }
  });

  test("Modbus TCP request is the MBAP frame for FC03 500 x5, unit 1 and unit 0", async () => {
    expect(tx(cases.get("tcp/read-unit-1")!)).toEqual([MBAP.read]);
    expect(tx(cases.get("tcp/read-unit-0")!)).toEqual([MBAP.readUnit0]);
  });

  test("rtu-over-tcp puts the same MBAP frame on the wire: modbus-serial strips the CRC", async () => {
    expect(tx(cases.get("rtu-over-tcp/read-unit-1")!)).toEqual([MBAP.read]);
    expect(tx(cases.get("rtu-over-tcp/read-unit-0")!)).toEqual([MBAP.readUnit0]);
  });

  test("decodes scale, sign and the low-word-first double word", async () => {
    const c = (await corpus()).get("tcp/read-unit-1")!;
    expect(c.result).toEqual({
      values: { "x.voltage": 230.5, "x.power": -1000, "x.energy": 7019.6, "x.limit": 14.9 },
    });
  });

  test("a write goes out as FC16 even for one word", async () => {
    for (const framing of ["tcp", "rtu-over-tcp"]) {
      expect(tx(cases.get(`${framing}/write-register`)!)).toEqual([MBAP.write]);
    }
  });

  test("Modbus exception 2 on a spanning read is split and remembered", async () => {
    const c = (await corpus()).get("tcp/exception-2-split")!;
    // Spanning block 500+21 (atomic group), refused; then the plain blocks 500+5 and 520+1.
    expect(tx(c).map((f) => f.slice(-8))).toEqual(["01f40015", "01f40005", "02080001"]);
    expect((c.result as { degraded?: boolean }).degraded).toBe(true);
  });

  test("Solarman: the probe asks with serial 0, the read uses the serial the stick named", async () => {
    const c = (await corpus()).get("solarman-v5/read-unit-1")!;
    expect(tx(c)).toEqual([SOLARMAN_PROBE, SOLARMAN_READ_SEQ1]);
    expect(c.loggerSerial).toBe(0xbce20a25);
  });

  test("Solarman: a wrong configured serial is corrected from the reject header", async () => {
    const c = (await corpus()).get("solarman-v5/logger-serial-discovery")!;
    expect(tx(c)).toEqual([SOLARMAN_PROBE, SOLARMAN_READ_SEQ1]);
    expect(c.loggerSerial).toBe(0xbce20a25);
  });

  test("Solarman reply is 14 bytes of business field, the request 15", async () => {
    const c = (await corpus()).get("solarman-v5/read-unit-1")!;
    const rx = c.exchanges.filter((e) => e.dir === "rx");
    const reply = rx[1] as { chunks: string[]; decoded: Array<{ kind: string; pdu?: string }> };
    // 11 header + 14 business + 15 RTU (01 03 0a + 5 words + crc) + 2 trailer
    expect(reply.chunks[0]!.length / 2).toBe(11 + 14 + 15 + 2);
    expect(reply.decoded[0]!.kind).toBe("response");
  });

  test("Solarman: a transient 05 is retried with the identical RTU frame under a fresh sequence", async () => {
    const c = (await corpus()).get("solarman-v5/transient-05-retried")!;
    const [, first, retry] = tx(c);
    expect(first!.slice(10, 14)).not.toBe(retry!.slice(10, 14));
    expect(first!.slice(52, -4)).toBe(retry!.slice(52, -4));
    expect(c.result).toHaveProperty("values");
  });

  test("Solarman: a persistent 05 surfaces as Modbus exception 2", async () => {
    const c = (await corpus()).get("solarman-v5/persistent-05-is-exception-2")!;
    expect(c.result).toMatchObject({ error: { modbusCode: 2 } });
  });

  test("Solarman: a 06 reject is an addressing failure, never exception 2", async () => {
    const c = (await corpus()).get("solarman-v5/wrong-serial-06")!;
    expect(c.result).toMatchObject({ error: { modbusCode: 10 } });
  });

  test("Solarman: heartbeat, stale sequence and corrupt checksum in one chunk change nothing", async () => {
    const c = (await corpus()).get("solarman-v5/heartbeat-and-stray-frames")!;
    const clean = (await corpus()).get("solarman-v5/read-unit-1")!;
    expect(c.result).toEqual(clean.result);
  });

  test("unit scan: only the unit the device answers reports present", async () => {
    const c = (await corpus()).get("tcp/probe-unit")!;
    expect(c.result).toEqual({ probe: { "0": false, "1": true } });
  });

  test("rtu-over-tcp's buffered reader skips junk before a reply; tcp's reader does not", async () => {
    const buffered = cases.get("rtu-over-tcp/leading-junk")!;
    const plain = cases.get("tcp/leading-junk")!;
    expect(buffered.result).toEqual(cases.get("rtu-over-tcp/read-unit-1")!.result);
    expect(plain.result).toHaveProperty("error");
  });

  test("a reply split across two TCP reads still decodes", async () => {
    for (const framing of ["tcp", "rtu-over-tcp", "solarman-v5"]) {
      const all = await corpus();
      const c = all.get(`${framing}/fragmented-reply`)!;
      const rx = c.exchanges.filter((e) => e.dir === "rx").at(-1) as { chunks: string[] };
      expect(rx.chunks.length).toBe(2);
      expect(c.result).toEqual(all.get(`${framing}/read-unit-1`)!.result);
    }
  });
});
