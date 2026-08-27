import { afterEach, describe, expect, test } from "bun:test";
import { SpotPriceUnpublished } from "../spot-price";
import { energyChartsPrices } from "./energy-charts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Shape of a real response, trimmed to the fields the parser reads. */
const payload = (over: object = {}) => ({
  unix_seconds: [1_785_535_200, 1_785_536_100, 1_785_537_000, 1_785_537_900],
  price: [88.4, 12.05, -3.2, -41.9],
  unit: "EUR / MWh",
  ...over,
});

let lastUrl = "";

/** Stub the transport so the provider's parse, URL and status mapping are all covered. */
function stub(body: unknown, status = 200): void {
  globalThis.fetch = ((input: string | URL | Request) => {
    lastUrl = String(input);
    return Promise.resolve(
      new Response(status === 200 ? JSON.stringify(body) : "", {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof globalThis.fetch;
}

// A Berlin-local day boundary: 2026-08-01T00:00 CEST → 2026-07-31T22:00Z.
const FROM = Date.parse("2026-07-31T22:00:00Z");
const TO = Date.parse("2026-08-02T22:00:00Z");

describe("energyChartsPrices", () => {
  test("advertises DE-LU and credits the CC BY source", () => {
    expect(energyChartsPrices.id).toBe("energy-charts");
    expect(energyChartsPrices.zones).toContain("DE-LU");
    expect(energyChartsPrices.zones).toContain("AT");
    // CC BY 4.0 makes attribution a licence condition, not decoration.
    expect(energyChartsPrices.attribution).toMatch(/CC BY 4\.0/);
  });

  test("asks for the market's own delivery days, end inclusive", async () => {
    stub(payload());
    await energyChartsPrices.fetch("DE-LU", FROM, TO);
    expect(lastUrl).toContain("bzn=DE-LU");
    // `end` is the last delivery day wanted, so the exclusive window end maps to
    // the day before it — asking for 08-03 would demand an unpublished day.
    expect(lastUrl).toContain("start=2026-08-01");
    expect(lastUrl).toContain("end=2026-08-02");
  });

  test("reads a quarter-hourly payload", async () => {
    stub(payload());
    const out = await energyChartsPrices.fetch("DE-LU", FROM, TO);
    expect(out.zone).toBe("DE-LU");
    // 900-second spacing is the true 15-minute MTU, read from the data.
    expect(out.resolutionMinutes).toBe(15);
    expect(out.startMs).toEqual([
      1_785_535_200_000, 1_785_536_100_000, 1_785_537_000_000, 1_785_537_900_000,
    ]);
    expect(out.eurPerMwh).toEqual([88.4, 12.05, -3.2, -41.9]);
  });

  test("hourly spacing is reported as hourly", async () => {
    stub(payload({ unix_seconds: [0, 3600, 7200, 10_800] }));
    const out = await energyChartsPrices.fetch("DE-LU", FROM, TO);
    expect(out.resolutionMinutes).toBe(60);
  });

  test("resolution comes from the first gap, not from the entry count", async () => {
    // A payload was observed whose length disagreed with the span its first and
    // last timestamps imply, so nothing may be derived from the length.
    stub({ unix_seconds: [0, 900, 1800], price: [1, 2, 3], unit: "EUR / MWh" });
    const out = await energyChartsPrices.fetch("DE-LU", FROM, TO);
    expect(out.resolutionMinutes).toBe(15);
    expect(out.startMs).toHaveLength(3);
  });

  test("a single-slot series falls back to hourly rather than claiming precision", async () => {
    stub({ unix_seconds: [0], price: [7], unit: "EUR / MWh" });
    const out = await energyChartsPrices.fetch("DE-LU", FROM, TO);
    expect(out.resolutionMinutes).toBe(60);
  });

  test("ct/kWh is converted to EUR/MWh", async () => {
    stub(payload({ unit: "ct/kWh", price: [20.443, 1, -2, -3] }));
    const out = await energyChartsPrices.fetch("AT", FROM, TO);
    expect(out.eurPerMwh[0]).toBeCloseTo(204.43, 6);
    expect(out.eurPerMwh[2]).toBeCloseTo(-20, 6);
  });

  test("an unexpected unit throws rather than mispricing silently", async () => {
    stub(payload({ unit: "USD/kWh" }));
    await expect(energyChartsPrices.fetch("DE-LU", FROM, TO)).rejects.toThrow(
      /unexpected price unit/,
    );
  });

  test("a timestamp without a usable price is dropped, never defaulted to zero", async () => {
    stub(payload({ price: [88.4, null, -3.2] }));
    const out = await energyChartsPrices.fetch("DE-LU", FROM, TO);
    expect(out.startMs).toEqual([1_785_535_200_000, 1_785_537_000_000]);
    expect(out.eurPerMwh).toEqual([88.4, -3.2]);
  });

  test("404 and 400 read as not-yet-published, not as failures", async () => {
    // The upstream rejects an unpublished delivery day outright instead of
    // returning an empty 200, and that is the expected state before the auction
    // clears — so it must not surface as a transport error every half hour.
    for (const status of [404, 400]) {
      stub(null, status);
      await expect(energyChartsPrices.fetch("DE-LU", FROM, TO)).rejects.toThrow(
        SpotPriceUnpublished,
      );
    }
  });

  test("a real transport failure stays a failure", async () => {
    stub(null, 503);
    const promise = energyChartsPrices.fetch("DE-LU", FROM, TO);
    await expect(promise).rejects.toThrow(/HTTP 503/);
    await expect(promise).rejects.not.toBeInstanceOf(SpotPriceUnpublished);
  });

  test("an empty series reads as not-yet-published", async () => {
    stub({ unix_seconds: [], price: [], unit: "EUR / MWh" });
    await expect(energyChartsPrices.fetch("DE-LU", FROM, TO)).rejects.toThrow(SpotPriceUnpublished);
  });

  test("a series with no usable slot reads as not-yet-published", async () => {
    stub({ unix_seconds: [0, 900], price: [null, null], unit: "EUR / MWh" });
    await expect(energyChartsPrices.fetch("DE-LU", FROM, TO)).rejects.toThrow(SpotPriceUnpublished);
  });
});
