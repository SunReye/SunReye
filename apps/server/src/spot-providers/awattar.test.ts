import { afterEach, describe, expect, test } from "bun:test";
import { SpotPriceUnpublished, toSpotRows } from "../spot-price";
import { awattarPrices } from "./awattar";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const HOUR_MS = 3_600_000;
const BASE = Date.parse("2026-08-02T00:00:00Z");

const entry = (i: number, marketprice: number | null) => ({
  start_timestamp: BASE + i * HOUR_MS,
  end_timestamp: BASE + (i + 1) * HOUR_MS,
  marketprice,
  unit: "Eur/MWh",
});

let lastUrl = "";

function stub(body: unknown, status = 200): void {
  globalThis.fetch = ((input: string | URL | Request) => {
    lastUrl = String(input);
    return Promise.resolve(new Response(status === 200 ? JSON.stringify(body) : "", { status }));
  }) as typeof globalThis.fetch;
}

describe("awattarPrices", () => {
  test("serves DE-LU and AT from their own hosts", async () => {
    stub({ data: [entry(0, 80)] });
    await awattarPrices.fetch("DE-LU", BASE, BASE + HOUR_MS);
    expect(lastUrl).toContain("api.awattar.de");
    await awattarPrices.fetch("AT", BASE, BASE + HOUR_MS);
    expect(lastUrl).toContain("api.awattar.at");
    expect(awattarPrices.zones).toEqual(["DE-LU", "AT"]);
  });

  test("a zone it does not serve fails loudly rather than guessing a host", async () => {
    await expect(awattarPrices.fetch("SE3", BASE, BASE + HOUR_MS)).rejects.toThrow(
      /does not serve/,
    );
  });

  test("the window maps straight onto epoch-ms bounds", async () => {
    stub({ data: [entry(0, 80)] });
    await awattarPrices.fetch("DE-LU", BASE, BASE + 2 * HOUR_MS);
    expect(lastUrl).toContain(`start=${BASE}`);
    expect(lastUrl).toContain(`end=${BASE + 2 * HOUR_MS}`);
  });

  test("reports itself as hourly, and fans out to the quarter-hour grid", async () => {
    stub({ data: [entry(0, 80), entry(1, -12)] });
    const series = await awattarPrices.fetch("DE-LU", BASE, BASE + 2 * HOUR_MS);
    expect(series.resolutionMinutes).toBe(60);

    // Eight stored slots, but every one still admits its hourly origin — a
    // negative quarter-hour inside a positive hour was never resolvable here.
    const rows = toSpotRows(series, awattarPrices.id);
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.slotMinutes === 60)).toBe(true);
    expect(rows.slice(4).every((r) => r.eurPerMwh === -12)).toBe(true);
  });

  test("an unexpected unit throws rather than mispricing silently", async () => {
    stub({ data: [{ ...entry(0, 80), unit: "ct/kWh" }] });
    await expect(awattarPrices.fetch("DE-LU", BASE, BASE + HOUR_MS)).rejects.toThrow(
      /unexpected price unit/,
    );
  });

  test("an entry with no price is dropped, never defaulted to zero", async () => {
    stub({ data: [entry(0, null), entry(1, 40)] });
    const series = await awattarPrices.fetch("DE-LU", BASE, BASE + 2 * HOUR_MS);
    expect(series.eurPerMwh).toEqual([40]);
  });

  test("empty data reads as not-yet-published, not as a failure", async () => {
    stub({ data: [] });
    await expect(awattarPrices.fetch("DE-LU", BASE, BASE + HOUR_MS)).rejects.toThrow(
      SpotPriceUnpublished,
    );
  });

  test("a real transport failure stays a failure", async () => {
    stub(null, 503);
    await expect(awattarPrices.fetch("DE-LU", BASE, BASE + HOUR_MS)).rejects.toThrow(/HTTP 503/);
  });
});
