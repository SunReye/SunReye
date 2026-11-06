import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { RecentBackfill } from "./live-metrics";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
vi.mock("$lib/ui-prefs.svelte", () => ({
  uiPrefs: { load: async () => {}, isHidden: () => false },
}));
vi.mock("$lib/ws/bus.svelte", () => ({ bus: { subscribe: () => () => {} } }));
const get = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));

const { inverter } = await import("./store.svelte");
const { source } = await import("$lib/source.svelte");
const { PLANT, STORAGE_KEY } = await import("$lib/source");
const roster = {
  plant: { members: ["a", "b"], timeZone: "Europe/Berlin" },
  devices: ["a", "b"].map((slug) => ({
    slug,
    name: `Device ${slug}`,
    profileId: "deye",
    role: "inverter",
    retired: false,
    member: true,
  })),
};

/** One `/api/history/recent` read, answered when the test says so. */
type Read = { source: string; seconds: number; answer: (data: RecentBackfill) => void };
let reads: Read[] = [];
let wake: (() => void) | null = null;

/** The n-th recent read (1-based), once the store has issued it. */
async function read(n: number): Promise<Read> {
  while (reads.length < n) await new Promise<void>((resolve) => (wake = resolve));
  return reads[n - 1]!;
}

/** Drain every pending microtask: a macrotask hop with no delay in it. */
const settle = () =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });

const payload = (t0: number, metric: string, values: number[]): RecentBackfill => ({
  t0,
  step: 1,
  metrics: { [metric]: { o: values.map((_, i) => i), v: values } },
});

beforeEach(() => {
  reads = [];
  wake = null;
  localStorage.removeItem(STORAGE_KEY);
  get.mockImplementation((path: string, init?: { params: { query: Record<string, unknown> } }) => {
    if (path === "/api/sources") return Promise.resolve({ data: roster });
    if (path !== "/api/history/recent") return Promise.resolve({ data: undefined });
    const { source, seconds } = init!.params.query as { source: string; seconds: number };
    return new Promise((resolve) => {
      reads.push({ source, seconds, answer: (data) => resolve({ data }) });
      wake?.();
    });
  });
});

let stop = () => {};

afterEach(async () => {
  // Back to the plant while still listening: the store drops the buffers on a switch.
  source.select(PLANT);
  stop();
  // Let the abandoned backfill issue its read before the next test counts reads.
  await settle();
  get.mockReset();
  localStorage.removeItem(STORAGE_KEY);
});

const T0 = 1_700_000_000_000;

test("a backfill still in flight for the source switched away from is dropped", async () => {
  stop = inverter.start();
  const plant = await read(1);
  expect(plant.source).toBe("plant");

  source.select("b");
  const device = await read(2);
  expect(device.source).toBe("b");
  device.answer(payload(T0, "dc.total_power", [222, 223]));
  await vi.waitFor(() => expect(inverter.series("dc.total_power")).toHaveLength(2));

  // The plant's read was issued first and lands last.
  plant.answer(payload(T0, "dc.total_power", [100, 101]));
  await settle();

  expect(inverter.series("dc.total_power")).toEqual([
    { t: T0, v: 222 },
    { t: T0 + 1000, v: 223 },
  ]);
});

test("switching source drops the old source's points and backfills the whole window", async () => {
  stop = inverter.start();
  const now = Date.now();
  (await read(1)).answer(payload(now - 4000, "plant.only", [1, 2, 3]));
  await vi.waitFor(() => expect(inverter.series("plant.only")).toHaveLength(3));

  source.select("b");
  const device = await read(2);
  // Held points would make this a gap read, merged onto the old source's line.
  expect(device.seconds).toBe(300);
  device.answer(payload(now - 4000, "dc.total_power", [7]));
  await vi.waitFor(() => expect(inverter.series("dc.total_power")).toHaveLength(1));

  expect(inverter.series("plant.only")).toEqual([]);
});
