import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { InverterConnection, InverterProfile, MetricDef, RegisterType } from "./types";

// --- fake Modbus transport -------------------------------------------------
//
// `ModbusInverter` reaches the wire through `new ModbusRTU()`, so the only way
// to exercise the read/write/lock/reconnect paths off-hardware is to replace the
// transport. The spread is load-bearing even for a third-party module:
// `mock.module` is process-global and permanent, so returning only `default`
// would delete `ServerTCP`, `TestPort`, ... for every test file that runs after
// this one.

/** Hooks each test rewires to drive the fake device's answers. */
const device = {
  connect: (async () => {}) as (host: string, opts: unknown) => Promise<void>,
  read: (async () => ({ data: [] as number[] })) as (
    start: number,
    count: number,
  ) => Promise<{ data: number[] }>,
  write: (async () => {}) as (addr: number, values: number[]) => Promise<void>,
};

/** Everything the fake observed, for assertions about the wire traffic. */
const wire = {
  instances: [] as FakeModbusRTU[],
  connects: [] as { framing: "tcp" | "rtu-over-tcp"; host: string; opts: unknown }[],
  reads: [] as { start: number; count: number }[],
  writes: [] as { addr: number; values: number[] }[],
  /** Transaction order, for proving a write never interleaves with a poll. */
  order: [] as string[],
  closes: 0,
};

class FakeModbusRTU {
  isOpen = false;
  unitId: number | undefined;
  timeoutMs: number | undefined;

  constructor() {
    wire.instances.push(this);
  }
  async connectTCP(host: string, opts: unknown): Promise<void> {
    wire.connects.push({ framing: "tcp", host, opts });
    await device.connect(host, opts);
    this.isOpen = true;
  }
  async connectTcpRTUBuffered(host: string, opts: unknown): Promise<void> {
    wire.connects.push({ framing: "rtu-over-tcp", host, opts });
    await device.connect(host, opts);
    this.isOpen = true;
  }
  setID(id: number): void {
    this.unitId = id;
  }
  setTimeout(ms: number): void {
    this.timeoutMs = ms;
  }
  async readHoldingRegisters(start: number, count: number): Promise<{ data: number[] }> {
    wire.reads.push({ start, count });
    wire.order.push(`read ${start}+${count}`);
    return device.read(start, count);
  }
  async writeRegisters(addr: number, values: number[]): Promise<void> {
    wire.writes.push({ addr, values });
    wire.order.push(`write ${addr}`);
    return device.write(addr, values);
  }
  close(cb?: () => void): void {
    wire.closes++;
    this.isOpen = false;
    cb?.();
  }
}

const realModbus = await import("modbus-serial");
mock.module("modbus-serial", () => ({ ...realModbus, default: FakeModbusRTU }));

const { ModbusInverter, planReads, splitBlock } = await import("./driver");

/** Minimal raw register metric. */
const raw = (key: string, addr: number, type: RegisterType = "U_WORD") =>
  ({
    key,
    topic: key,
    label: key,
    unit: null,
    group: "test",
    type,
    addresses: type === "U_DWORD" ? [addr, addr + 1] : [addr],
    scale: 1,
    access: "r",
  }) as MetricDef;

/** Minimal computed metric — only `computeInputs` matters to the planner. */
const derived = (key: string, computeInputs: string[]) =>
  ({
    key,
    topic: key,
    label: key,
    unit: null,
    group: "test",
    type: "U_WORD",
    addresses: [],
    scale: 1,
    access: "r",
    compute: () => 0,
    computeInputs,
  }) as MetricDef;

describe("planReads", () => {
  test("collapses contiguous addresses and splits on gaps (no computed metrics)", () => {
    const metrics = [raw("a", 10), raw("b", 11), raw("c", 12), raw("d", 200), raw("e", 201)];
    expect(planReads(metrics)).toEqual([
      { start: 10, count: 3 },
      { start: 200, count: 2 },
    ]);
  });

  test("spans a computed metric's inputs into one atomic block across gaps", () => {
    // Deye power-flow layout: battery 590, grid 625, load 653, PV 672-675.
    const metrics = [
      raw("battery.power", 590),
      raw("ac.total_power", 625),
      raw("ac.ups.total_power", 653),
      raw("dc.pv1.power", 672),
      raw("dc.pv2.power", 673),
      raw("dc.pv3.power", 674),
      raw("dc.pv4.power", 675),
      derived("dc.total_power", ["dc.pv1.power", "dc.pv2.power", "dc.pv3.power", "dc.pv4.power"]),
      derived("inverter.power", [
        "dc.total_power",
        "battery.power",
        "ac.total_power",
        "ac.ups.total_power",
      ]),
    ];
    expect(planReads(metrics)).toEqual([{ start: 590, count: 86, grouped: true }]);
  });

  test("resolves inputs transitively through chained computed metrics", () => {
    const metrics = [
      raw("battery.power", 590),
      raw("dc.total", 672),
      derived("battery.discharge", ["battery.power"]), // clamp
      derived("battery.charge", ["battery.discharge", "battery.power"]), // diff
      derived("efficiency", ["dc.total", "battery.charge"]), // ratio
    ];
    expect(planReads(metrics)).toEqual([{ start: 590, count: 83, grouped: true }]);
  });

  test("plans ungrouped addresses around an atomic block", () => {
    const metrics = [
      raw("a", 100),
      raw("b", 590),
      raw("c", 600),
      raw("d", 900),
      derived("x", ["b", "c"]),
    ];
    expect(planReads(metrics)).toEqual([
      { start: 100, count: 1 },
      { start: 590, count: 11, grouped: true },
      { start: 900, count: 1 },
    ]);
  });

  test("addresses inside an atomic span are not read a second time", () => {
    const metrics = [raw("a", 590), raw("mid", 600), raw("b", 610), derived("x", ["a", "b"])];
    // `mid` falls inside the 590-610 span; a second read of it would overwrite
    // the atomic sample with a later one.
    expect(planReads(metrics)).toEqual([{ start: 590, count: 21, grouped: true }]);
  });

  test("merges computed groups whose address ranges overlap", () => {
    const metrics = [
      raw("a", 100),
      raw("b", 150),
      raw("c", 140),
      raw("d", 180),
      derived("x", ["a", "b"]), // 100-150
      derived("y", ["c", "d"]), // 140-180 — overlaps x
    ];
    expect(planReads(metrics)).toEqual([{ start: 100, count: 81, grouped: true }]);
  });

  test("a group wider than the register cap falls back to split reads (and warns)", () => {
    // The LogTape warning is a no-op here (no sinks configured in tests); the
    // observable contract is the split fallback plan.
    const metrics = [raw("a", 100), raw("b", 400), derived("x", ["a", "b"])];
    expect(planReads(metrics)).toEqual([
      { start: 100, count: 1 },
      { start: 400, count: 1 },
    ]);
  });

  test("single-register groups need no atomic block", () => {
    const metrics = [raw("a", 100), derived("x", ["a"]), derived("y", ["a", "missing"])];
    expect(planReads(metrics)).toEqual([{ start: 100, count: 1 }]);
  });

  test("U_DWORD inputs contribute both words to the group", () => {
    const metrics = [raw("wide", 500, "U_DWORD"), raw("b", 510), derived("x", ["wide", "b"])];
    expect(planReads(metrics)).toEqual([{ start: 500, count: 11, grouped: true }]);
  });
});

describe("splitBlock", () => {
  test("re-plans a spanning block into gap-split blocks of its mapped addresses", () => {
    const metrics = [
      raw("a", 590),
      raw("b", 625),
      raw("c", 626),
      raw("d", 675),
      raw("outside", 900),
      derived("x", ["a", "b", "c", "d"]),
    ];
    expect(splitBlock({ start: 590, count: 86, grouped: true }, metrics)).toEqual([
      { start: 590, count: 1 },
      { start: 625, count: 2 },
      { start: 675, count: 1 },
    ]);
  });
});

// --- ModbusInverter --------------------------------------------------------

/** Metric with every field defaulted, so a test only states what it is about. */
const def = (over: Partial<MetricDef> & { key: string }): MetricDef =>
  ({
    topic: over.key,
    label: over.key,
    unit: null,
    group: "test",
    type: "U_WORD",
    addresses: [],
    scale: 1,
    access: "r",
    ...over,
  }) as MetricDef;

const profileOf = (metrics: MetricDef[]): InverterProfile => ({
  id: "test-inverter",
  name: "Test Inverter",
  manufacturer: "Test",
  metrics,
});

const connection = (over: Partial<InverterConnection> = {}): InverterConnection => ({
  host: "10.0.0.5",
  port: 502,
  unitId: 1,
  ...over,
});

/** A device whose holding registers hold `values`; anything else answers 0. */
const bank =
  (values: Record<number, number>) =>
  async (start: number, count: number): Promise<{ data: number[] }> => ({
    data: Array.from({ length: count }, (_, i) => values[start + i] ?? 0),
  });

/** Modbus exception 2 as modbus-serial surfaces it. */
const illegalDataAddress = () =>
  Object.assign(new Error("Modbus exception 2: Illegal data address"), { modbusCode: 2 });

/** A promise plus its resolver, for holding a transaction open mid-test. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  device.connect = async () => {};
  device.read = async () => ({ data: [] });
  device.write = async () => {};
  wire.instances.length = 0;
  wire.connects.length = 0;
  wire.reads.length = 0;
  wire.writes.length = 0;
  wire.order.length = 0;
  wire.closes = 0;
});

describe("ModbusInverter connection", () => {
  test("dials the configured host with Modbus TCP framing, unit id and timeout", async () => {
    const inv = new ModbusInverter(
      profileOf([raw("a", 100)]),
      connection({ host: "192.168.1.40", port: 8899, unitId: 3, timeoutMs: 750 }),
    );
    await inv.read();

    expect(wire.connects).toEqual([{ framing: "tcp", host: "192.168.1.40", opts: { port: 8899 } }]);
    expect(wire.instances[0]!.unitId).toBe(3);
    expect(wire.instances[0]!.timeoutMs).toBe(750);
  });

  test("dials with RTU-over-TCP framing behind an RS485 gateway", async () => {
    const inv = new ModbusInverter(
      profileOf([raw("a", 100)]),
      connection({ transport: "rtu-over-tcp" }),
    );
    await inv.read();

    expect(wire.connects[0]!.framing).toBe("rtu-over-tcp");
  });

  test("falls back to a two second timeout when the connection omits one", async () => {
    const inv = new ModbusInverter(profileOf([raw("a", 100)]), connection());
    await inv.read();

    expect(wire.instances[0]!.timeoutMs).toBe(2000);
  });

  test("reuses the open socket across polls", async () => {
    const inv = new ModbusInverter(profileOf([raw("a", 100)]), connection());
    await inv.read();
    await inv.read();

    expect(wire.instances).toHaveLength(1);
    expect(wire.connects).toHaveLength(1);
  });

  test("overlapping polls share a single connection attempt", async () => {
    const opening = deferred();
    device.connect = () => opening.promise;
    const inv = new ModbusInverter(profileOf([raw("a", 100)]), connection());

    const polls = Promise.all([inv.read(), inv.read(), inv.read()]);
    opening.resolve();
    await polls;

    expect(wire.instances).toHaveLength(1);
    expect(wire.connects).toHaveLength(1);
  });

  test("reconnects after the gateway drops the socket underneath it", async () => {
    const inv = new ModbusInverter(profileOf([raw("a", 100)]), connection());
    await inv.read();
    wire.instances[0]!.isOpen = false; // gateway hung up between polls
    await inv.read();

    expect(wire.instances).toHaveLength(2);
    expect(wire.connects).toHaveLength(2);
  });

  test("fails fast when an unreachable host never completes the connect", async () => {
    device.connect = () => new Promise<void>(() => {}); // never settles
    const inv = new ModbusInverter(
      profileOf([raw("a", 100)]),
      connection({ host: "10.9.9.9", port: 502, timeoutMs: 5 }),
    );

    await expect(inv.read()).rejects.toThrow("connect to 10.9.9.9:502 timed out");
    expect(wire.closes).toBe(1); // the half-open socket is not leaked
  });

  test("retries the connection on the next poll after a refused attempt", async () => {
    let attempts = 0;
    device.connect = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("ECONNREFUSED");
    };
    const inv = new ModbusInverter(profileOf([raw("a", 100)]), connection());

    await expect(inv.read()).rejects.toThrow("ECONNREFUSED");
    await inv.read();

    expect(wire.instances).toHaveLength(2);
  });
});

describe("ModbusInverter read", () => {
  test("decodes each register encoding through its scale and offset", async () => {
    const inv = new ModbusInverter(
      profileOf([
        def({ key: "ac.voltage", addresses: [100], scale: 0.1 }),
        def({ key: "ac.power", type: "S_WORD", addresses: [101] }),
        def({ key: "battery.temperature", addresses: [102], scale: 0.1, offset: -100 }),
        def({ key: "energy.total", type: "U_DWORD", addresses: [103, 104], scale: 0.1 }),
      ]),
      connection(),
    );
    device.read = bank({
      100: 2301,
      101: 0xffc4, // -60 W: the house is exporting
      102: 1000, // vendor "+1000" encoding of 0.0 °C
      103: 0xffff,
      104: 2,
    });

    const sample = await inv.read();

    expect(sample.inverterId).toBe("test-inverter");
    expect(sample.metrics["ac.voltage"]).toBeCloseTo(230.1, 6);
    expect(sample.metrics["ac.power"]).toBe(-60);
    expect(sample.metrics["battery.temperature"]).toBeCloseTo(0, 6);
    expect(sample.metrics["energy.total"]).toBeCloseTo(19660.7, 4);
  });

  test("reports a reading of exactly zero rather than dropping the metric", async () => {
    const inv = new ModbusInverter(
      profileOf([def({ key: "ac.total_power", type: "S_WORD", addresses: [100] })]),
      connection(),
    );
    device.read = bank({ 100: 0 });

    const sample = await inv.read();

    expect(Object.keys(sample.metrics)).toContain("ac.total_power");
    expect(sample.metrics["ac.total_power"]).toBe(0);
  });

  test("stamps the sample with the time it was taken", async () => {
    const inv = new ModbusInverter(profileOf([raw("a", 100)]), connection());
    const before = Date.now();
    const sample = await inv.read();

    expect(Date.parse(sample.time)).toBeGreaterThanOrEqual(before - 1);
    expect(Date.parse(sample.time)).toBeLessThanOrEqual(Date.now());
  });

  test("treats a register the device left out of a short frame as zero", async () => {
    const inv = new ModbusInverter(
      profileOf([def({ key: "a", addresses: [100] }), def({ key: "b", addresses: [101] })]),
      connection(),
    );
    device.read = async () => ({ data: [7] }); // two asked for, one answered

    const sample = await inv.read();

    expect(sample.metrics).toEqual({ a: 7, b: 0 });
  });

  test("skips metrics that own no register: RAW, addressless and composite controls", async () => {
    const inv = new ModbusInverter(
      profileOf([
        def({ key: "system.time", type: "RAW", addresses: [100, 101, 102] }),
        def({ key: "unmapped", addresses: [] }),
        def({
          key: "battery.hold",
          access: "rw",
          controlExpr: { snapshotToggle: { target: "battery.soc", lockedValue: 50 } },
        }),
        def({ key: "battery.soc", addresses: [200] }),
      ]),
      connection(),
    );
    device.read = bank({ 200: 42 });

    const sample = await inv.read();

    expect(sample.metrics).toEqual({ "battery.soc": 42 });
    expect(wire.reads).toEqual([{ start: 200, count: 1 }]); // RAW is never on the wire
  });

  test("derives computed metrics from the decoded sample and clamps them to range", async () => {
    const inv = new ModbusInverter(
      profileOf([
        def({ key: "dc.power", addresses: [100] }),
        def({ key: "ac.power", addresses: [101] }),
        def({
          key: "inverter.efficiency",
          unit: "%",
          range: { min: 0, max: 100 },
          compute: (v) => (v["ac.power"]! / v["dc.power"]!) * 100,
          computeInputs: ["ac.power", "dc.power"],
        }),
      ]),
      connection(),
    );
    device.read = bank({ 100: 1000, 101: 1200 }); // impossible >100 % on a swing

    const sample = await inv.read();

    expect(sample.metrics["inverter.efficiency"]).toBe(100);
  });

  test("splits an atomic block the device rejects, and still returns every metric", async () => {
    const metrics = [
      def({ key: "battery.power", type: "S_WORD", addresses: [590] }),
      def({ key: "dc.power", addresses: [600] }),
      def({
        key: "inverter.power",
        compute: (v) => v["dc.power"]! + v["battery.power"]!,
        computeInputs: ["dc.power", "battery.power"],
      }),
    ];
    const inv = new ModbusInverter(profileOf(metrics), connection());
    const answer = bank({ 590: 0xff9c, 600: 1500 }); // -100 W discharge
    device.read = async (start, count) => {
      if (start === 590 && count === 11) throw illegalDataAddress();
      return answer(start, count);
    };

    const sample = await inv.read();

    expect(wire.reads).toEqual([
      { start: 590, count: 11 },
      { start: 590, count: 1 },
      { start: 600, count: 1 },
    ]);
    expect(sample.metrics).toEqual({
      "battery.power": -100,
      "dc.power": 1500,
      "inverter.power": 1400,
    });
  });

  test("keeps the split plan for every later poll instead of re-probing the span", async () => {
    const metrics = [
      def({ key: "a", addresses: [590] }),
      def({ key: "b", addresses: [600] }),
      def({ key: "x", compute: (v) => v["a"]! + v["b"]!, computeInputs: ["a", "b"] }),
    ];
    const inv = new ModbusInverter(profileOf(metrics), connection());
    device.read = async (start, count) => {
      if (start === 590 && count === 11) throw illegalDataAddress();
      return bank({ 590: 1, 600: 2 })(start, count);
    };

    await inv.read();
    wire.reads.length = 0;
    await inv.read();

    expect(wire.reads).toEqual([
      { start: 590, count: 1 },
      { start: 600, count: 1 },
    ]);
  });

  test("propagates an illegal-data-address on a plain block — no span to blame", async () => {
    const inv = new ModbusInverter(profileOf([raw("a", 100)]), connection());
    device.read = async () => {
      throw illegalDataAddress();
    };

    await expect(inv.read()).rejects.toThrow("Illegal data address");
    expect(wire.reads).toHaveLength(1); // no fallback attempted
  });

  test.each([
    ["a different Modbus exception", Object.assign(new Error("slave failure"), { modbusCode: 4 })],
    ["a transport error carrying no Modbus code", new Error("Port Not Open")],
    ["a rejection that is not an object at all", "ETIMEDOUT"],
    ["a null rejection", null],
  ])("propagates %s raised by an atomic block", async (_label, thrown) => {
    const metrics = [
      def({ key: "a", addresses: [590] }),
      def({ key: "b", addresses: [600] }),
      def({ key: "x", compute: (v) => v["a"]! + v["b"]!, computeInputs: ["a", "b"] }),
    ];
    const inv = new ModbusInverter(profileOf(metrics), connection());
    device.read = async () => {
      throw thrown;
    };

    // Identity, not just "it rejected": the caller's retry/backoff branches on
    // the original error, so a wrapped or substituted one is a real regression.
    await expect(inv.read()).rejects.toBe(thrown);
    expect(wire.reads).toEqual([{ start: 590, count: 11 }]); // never split
  });

  test("a failed poll leaves the transaction lock usable for the next one", async () => {
    const inv = new ModbusInverter(profileOf([raw("a", 100)]), connection());
    device.read = async () => {
      throw new Error("Timed out");
    };

    await expect(inv.read()).rejects.toThrow("Timed out");
    device.read = bank({ 100: 5 });

    expect((await inv.read()).metrics).toEqual({ a: 5 });
  });
});

describe("ModbusInverter write", () => {
  const writable = (over: Partial<MetricDef> & { key: string }) =>
    def({ access: "rw", addresses: [200], ...over });

  test("refuses a metric the profile does not define", async () => {
    const inv = new ModbusInverter(profileOf([raw("a", 100)]), connection());

    await expect(inv.write("battery.nonsense", 1)).rejects.toThrow(
      "unknown metric: battery.nonsense",
    );
    expect(wire.writes).toEqual([]);
  });

  test("refuses to write a read-only measurement", async () => {
    const inv = new ModbusInverter(
      profileOf([def({ key: "battery.soc", addresses: [200] })]),
      connection(),
    );

    await expect(inv.write("battery.soc", 80)).rejects.toThrow("metric is read-only: battery.soc");
    expect(wire.writes).toEqual([]);
  });

  test.each([
    ["a 32-bit counter", { type: "U_DWORD" as RegisterType, addresses: [200, 201] }],
    ["an opaque RAW block", { type: "RAW" as RegisterType, addresses: [200, 201, 202] }],
    ["an addressless composite control", { addresses: [] }],
    // Single-address but not a word type: the address-count check passes, so
    // only the type check can reject these. Without it a RAW/U_DWORD metric
    // that happens to declare one address would be written as a bare word.
    ["a single-address RAW block", { type: "RAW" as RegisterType, addresses: [200] }],
    ["a single-address 32-bit counter", { type: "U_DWORD" as RegisterType, addresses: [200] }],
  ])("refuses to write %s as a single word", async (_label, shape) => {
    const inv = new ModbusInverter(
      profileOf([writable({ key: "target", ...shape })]),
      connection(),
    );

    await expect(inv.write("target", 1)).rejects.toThrow(
      "metric is not a single-word writable register: target",
    );
    expect(wire.writes).toEqual([]);
  });

  test("writes a single word with FC16, which Deye settings registers require", async () => {
    const inv = new ModbusInverter(
      profileOf([writable({ key: "battery.max_soc", addresses: [204] })]),
      connection(),
    );

    await inv.write("battery.max_soc", 95);

    expect(wire.writes).toEqual([{ addr: 204, values: [95] }]);
  });

  test("encodes the engineering value back through scale and offset", async () => {
    const inv = new ModbusInverter(
      profileOf([writable({ key: "battery.float_voltage", scale: 0.01, addresses: [99] })]),
      connection(),
    );

    await inv.write("battery.float_voltage", 53.25);

    expect(wire.writes).toEqual([{ addr: 99, values: [5325] }]);
  });

  test("writes a zero setpoint — a zero export limit is a real setting", async () => {
    const inv = new ModbusInverter(
      profileOf([writable({ key: "grid.export_limit" })]),
      connection(),
    );

    await inv.write("grid.export_limit", 0);

    expect(wire.writes).toEqual([{ addr: 200, values: [0] }]);
  });

  test("encodes a negative setpoint as two's complement", async () => {
    const inv = new ModbusInverter(
      profileOf([writable({ key: "grid.setpoint", type: "S_WORD" })]),
      connection(),
    );

    await inv.write("grid.setpoint", -60);

    expect(wire.writes).toEqual([{ addr: 200, values: [0xffc4] }]);
  });

  test("never interleaves a write with an in-flight poll", async () => {
    const gate = deferred();
    const inv = new ModbusInverter(
      profileOf([
        def({ key: "a", addresses: [100] }),
        def({ key: "b", addresses: [300] }),
        writable({ key: "setting", addresses: [500] }),
      ]),
      connection(),
    );
    device.read = async (start, count) => {
      await gate.promise;
      return bank({ 100: 1, 300: 2 })(start, count);
    };

    const poll = inv.read();
    const write = inv.write("setting", 7);
    gate.resolve();
    await Promise.all([poll, write]);

    // The write waits for the *whole* poll, not just the block it collides with.
    expect(wire.order).toEqual(["read 100+1", "read 300+1", "read 500+1", "write 500"]);
  });
});

describe("ModbusInverter close", () => {
  test("closes the open socket and connects a fresh one on the next poll", async () => {
    const inv = new ModbusInverter(profileOf([raw("a", 100)]), connection());
    await inv.read();
    await inv.close();

    expect(wire.closes).toBe(1);
    expect(wire.instances[0]!.isOpen).toBe(false);

    await inv.read();
    expect(wire.instances).toHaveLength(2);
  });

  test("is a no-op when the inverter was never connected", async () => {
    const inv = new ModbusInverter(profileOf([raw("a", 100)]), connection());

    await inv.close();

    expect(wire.instances).toEqual([]);
    expect(wire.closes).toBe(0);
  });

  test("closing twice does not close the socket twice", async () => {
    const inv = new ModbusInverter(profileOf([raw("a", 100)]), connection());
    await inv.read();
    await inv.close();
    await inv.close();

    expect(wire.closes).toBe(1);
  });
});
