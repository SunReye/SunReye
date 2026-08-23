import { beforeEach, describe, expect, test } from "bun:test";

import { clampReports, resetClampReports } from "./codec";
import { HttpReadError, HttpTransport } from "./http-transport";
import type { DeviceTransport, HttpConnection, InverterProfile, MetricDef } from "./types";

// The fetch is injected rather than swapped onto `globalThis`: a global swap is
// permanent for the rest of the process if a restore is ever missed, exactly the
// hazard the repo documents for `mock.module`. Injection makes the leak
// impossible instead of merely unlikely.

/** An http-bound metric; `over` covers scale, offset, range, access. */
const def = (key: string, pointer: string, over: Partial<MetricDef> = {}): MetricDef => ({
  key,
  topic: key.replaceAll(".", "/"),
  label: key,
  unit: null,
  group: "grid",
  // The deprecated register mirror, seeded neutral exactly as the upcast does.
  type: "U_WORD",
  addresses: [],
  scale: 1,
  access: "r",
  binding: { via: "http", pointer },
  ...over,
});

const profileOf = (metrics: MetricDef[]): InverterProfile => ({
  id: "test-meter",
  name: "Test Meter",
  manufacturer: "ACME",
  metrics,
});

const conn = (over: Partial<HttpConnection> = {}): HttpConnection => ({
  url: "http://10.0.0.9/rpc/Shelly.GetStatus",
  ...over,
});

/** Records every request, and answers with whatever the test set up. */
function fetcher(answer: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const calls: string[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push(String(input));
    return Promise.resolve(answer(String(input), init));
  };
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

/** A transport answering one fixed JSON body. */
const serving = (body: unknown, metrics: MetricDef[], over: Partial<HttpConnection> = {}) => {
  const { calls, fetch } = fetcher(
    () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  return { calls, transport: new HttpTransport(profileOf(metrics), conn(over), { fetch }) };
};

/** Excerpt of a real Shelly Pro 3EM `Shelly.GetStatus` body. */
const shelly = {
  "em:0": {
    id: 0,
    a_voltage: 236.1,
    a_act_power: 951.2,
    b_act_power: -951.1,
    total_act_power: 2484.782,
    errors: ["phase_sequence"],
  },
  "emdata:0": { total_act: 1_234_567, total_act_ret: 0 },
  sys: { unixtime: null },
};

describe("HttpTransport identity", () => {
  test("declares itself read-only and poll-based", () => {
    const { transport } = serving({}, []);

    expect(transport.kind).toBe("http");
    expect(transport.caps).toEqual({ canWrite: false, pushBased: false });
  });
});

describe("HttpTransport read", () => {
  beforeEach(() => {
    resetClampReports();
  });

  test("decodes a fixed body to engineering values through the shared pipeline", async () => {
    const { transport, calls } = serving(shelly, [
      def("grid.power", "/em:0/total_act_power"),
      def("grid.phase.voltage", "/em:0/a_voltage"),
      // Wh -> kWh is what `scale` has always been for; no new machinery.
      def("grid.energy.imported.total", "/emdata:0/total_act", { scale: 0.001 }),
    ]);

    const { values } = await transport.read();

    expect(values).toEqual({
      "grid.power": 2484.782,
      "grid.phase.voltage": 236.1,
      "grid.energy.imported.total": 1234.567,
    });
    expect(calls).toEqual(["http://10.0.0.9/rpc/Shelly.GetStatus"]);
  });

  test("one GET serves every metric, however many there are", async () => {
    const { transport, calls } = serving(shelly, [
      def("a", "/em:0/a_act_power"),
      def("b", "/em:0/b_act_power"),
      def("c", "/em:0/total_act_power"),
    ]);

    await transport.read();
    await transport.read();

    expect(calls).toHaveLength(2);
  });

  test("applies scale, offset and the range clamp exactly as the register path does", async () => {
    const { transport } = serving({ t: 1250, soc: 655.35 }, [
      def("temp", "/t", { scale: 0.1, offset: -100 }),
      def("battery.soc", "/soc", { range: { min: 0, max: 100 } }),
    ]);

    const { values } = await transport.read();

    expect(values["temp"]).toBeCloseTo(25);
    expect(values["battery.soc"]).toBe(100);
    // Same ledger as `decode`'s clamps — one report per key, whatever the source.
    expect(clampReports().map((r) => r.key)).toEqual(["battery.soc"]);
  });

  test("keeps a negative reading negative — the body is already signed", async () => {
    const { transport } = serving(shelly, [def("grid.phase.power", "/em:0/b_act_power")]);

    expect((await transport.read()).values["grid.phase.power"]).toBe(-951.1);
  });

  test("resolves escaped and indexed pointer tokens per RFC 6901", async () => {
    const body = { "a/b": { "c~d": 1 }, list: [10, 20, 30], "": { x: 4 } };
    const { transport } = serving(body, [
      def("escaped", "/a~1b/c~0d"),
      def("indexed", "/list/2"),
      def("empty.key", "//x"),
    ]);

    expect((await transport.read()).values).toEqual({
      escaped: 1,
      indexed: 30,
      "empty.key": 4,
    });
  });

  test("reports no per-metric read times — one GET is one snapshot", async () => {
    const { transport } = serving(shelly, [def("grid.power", "/em:0/total_act_power")]);
    // Through the interface, where both fields exist: the class narrows its own
    // return type to say it never reports them, which is the claim under test.
    const seam: DeviceTransport = transport;

    const result = await seam.read();

    expect(result.readAt).toBeUndefined();
    expect(result.degraded).toBeUndefined();
  });

  test("skips a metric bound to anything but http — a register is not its business", async () => {
    const { transport } = serving({ a: 1 }, [
      def("http.one", "/a"),
      {
        ...def("modbus.one", "/a"),
        key: "modbus.one",
        binding: { via: "modbus", addr: [500], type: "U_WORD" },
      },
    ]);

    expect((await transport.read()).values).toEqual({ "http.one": 1 });
  });
});

// Zero is a legitimate reading for grid power (a balanced house) and for an
// export counter, so a fabricated zero is indistinguishable from a real one and
// would steer the automation engines. Every way a pointer can fail to produce a
// number must produce no metric at all.
describe("HttpTransport absent values", () => {
  const absent = async (body: unknown, pointer = "/x") => {
    const { transport } = serving(body, [def("m", pointer)]);
    return (await transport.read()).values;
  };

  test("a pointer that resolves to nothing yields no metric, not 0", async () => {
    expect(await absent({ other: 1 })).toEqual({});
  });

  test("a pointer through a missing branch yields no metric", async () => {
    expect(await absent({ a: { b: 1 } }, "/a/nope/c")).toEqual({});
  });

  test("a null value yields no metric — the device said 'I do not know'", async () => {
    // Real case: Shelly's `sys.unixtime` is null until NTP has synced.
    expect(await absent({ sys: { unixtime: null } }, "/sys/unixtime")).toEqual({});
  });

  test.each([
    ["an object", { x: { nested: 1 } }],
    ["an array", { x: [1, 2] }],
    ["a string", { x: "951.2" }],
    ["a boolean", { x: true }],
  ])("%s is not a reading", async (_label, body) => {
    expect(await absent(body)).toEqual({});
  });

  test("a non-finite number yields no metric", async () => {
    // JSON has no NaN or Infinity literal, but `1e999` parses to Infinity — and
    // an infinite reading poisons every value derived from it.
    const transport = new HttpTransport(profileOf([def("m", "/x")]), conn(), {
      fetch: fetcher(() => new Response('{"x": 1e999}')).fetch,
    });

    expect((await transport.read()).values).toEqual({});
  });

  test("a value that only goes non-finite after scaling yields no metric", async () => {
    // The raw number is finite, so the pointer walk is happy; `1e308 * 10`
    // overflows. Infinity is not a reading, and it serializes to `null` on the
    // wire — a hole that looks like a decode bug three layers away.
    const { transport } = serving({ p: 1e308, q: -1e308 }, [
      def("power", "/p", { scale: 10 }),
      def("neg", "/q", { scale: 10 }),
    ]);

    expect((await transport.read()).values).toEqual({});
  });

  test("does not read a value off the prototype chain", async () => {
    // A pointer whose token happens to name an inherited property must miss.
    // JSON.parse never produces an inherited key, but a polluted Object.prototype
    // would otherwise fabricate a reading for a metric the device never sent.
    const polluted = Object.prototype as unknown as Record<string, unknown>;
    polluted["soc"] = 42;
    try {
      const { transport } = serving({ other: 1 }, [def("battery.soc", "/soc")]);

      expect((await transport.read()).values).toEqual({});
    } finally {
      delete polluted["soc"];
    }
  });

  test("an index past the end of an array yields no metric", async () => {
    expect(await absent({ x: [] }, "/x/0")).toEqual({});
  });

  test("a numeric-looking key does not index an array", async () => {
    // `/x/01` is the literal key "01" per RFC 6901, never index 1.
    expect(await absent({ x: [10, 20] }, "/x/01")).toEqual({});
  });
});

// A device that is unreachable, one that answers 404, and one that answers
// nonsense are three different faults with three different fixes. Collapsing
// them into one generic failure is what makes an integration undebuggable.
describe("HttpTransport failures are distinguishable", () => {
  const failing = (answer: () => Promise<Response> | Response) =>
    new HttpTransport(profileOf([def("m", "/x")]), conn(), { fetch: fetcher(answer).fetch });

  test("a non-200 surfaces as a status failure carrying the code", async () => {
    const transport = failing(() => new Response("nope", { status: 404 }));

    const err = (await transport.read().catch((e: unknown) => e)) as HttpReadError;

    expect(err).toBeInstanceOf(HttpReadError);
    expect(err.kind).toBe("status");
    expect(err.status).toBe(404);
    expect(err.message).toContain("404");
  });

  test("a 401 is a status failure like any other — auth is out of scope, not silent", async () => {
    const transport = failing(() => new Response("", { status: 401 }));

    const err = (await transport.read().catch((e: unknown) => e)) as HttpReadError;

    expect(err.kind).toBe("status");
    expect(err.status).toBe(401);
  });

  test("a timeout surfaces as a timeout, not as a generic network failure", async () => {
    const transport = failing(() => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });

    const err = (await transport.read().catch((e: unknown) => e)) as HttpReadError;

    expect(err.kind).toBe("timeout");
    expect(err.message).toContain("http://10.0.0.9/rpc/Shelly.GetStatus");
  });

  test("an unreachable host surfaces as a network failure, keeping its cause", async () => {
    const cause = new Error("ECONNREFUSED");
    const transport = failing(() => {
      throw cause;
    });

    const err = (await transport.read().catch((e: unknown) => e)) as HttpReadError;

    expect(err.kind).toBe("network");
    expect(err.cause).toBe(cause);
  });

  test("a body that is not JSON surfaces as malformed", async () => {
    const transport = failing(() => new Response("<html>login</html>", { status: 200 }));

    const err = (await transport.read().catch((e: unknown) => e)) as HttpReadError;

    expect(err.kind).toBe("malformed");
  });

  test("valid JSON that is not an object surfaces as malformed, not as absent metrics", async () => {
    // An array or a bare number means the endpoint is wrong, which is a fault to
    // report — not thirty metrics quietly reading absent.
    const transport = failing(() => new Response("[1,2,3]"));

    expect(((await transport.read().catch((e: unknown) => e)) as HttpReadError).kind).toBe(
      "malformed",
    );
  });

  test("the request carries a deadline so an unanswering device cannot hang the poll", async () => {
    let signal: AbortSignal | undefined;
    const fetch = ((_input: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return Promise.resolve(new Response("{}"));
    }) as unknown as typeof globalThis.fetch;

    await new HttpTransport(profileOf([]), conn({ timeoutMs: 250 }), { fetch }).read();

    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

describe("HttpTransport write", () => {
  test("refuses before any request is made — the transport cannot write at all", async () => {
    const { calls, transport } = serving({}, [def("m", "/x", { access: "rw" })]);

    await expect(transport.write("m", 1)).rejects.toThrow("cannot write");
    expect(calls).toEqual([]);
  });

  test("refuses an unknown metric the same way", async () => {
    const { calls, transport } = serving({}, [def("m", "/x")]);

    await expect(transport.write("nonsense", 1)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("HttpTransport lifecycle", () => {
  test("connect and close never touch the network — there is nothing to open", async () => {
    const { calls, transport } = serving({ x: 1 }, [def("m", "/x")]);

    await transport.connect();
    await transport.close();

    expect(calls).toEqual([]);
  });

  test("reads still work after a close — a GET carries its own connection", async () => {
    const { transport } = serving({ x: 1 }, [def("m", "/x")]);

    await transport.close();

    expect((await transport.read()).values).toEqual({ m: 1 });
  });
});
