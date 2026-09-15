import { describe, expect, test } from "bun:test";

import {
  DEFAULT_UNIT_CANDIDATES,
  MAX_CANDIDATES,
  type UnitScanner,
  scanUnitIds,
} from "./unit-scan";

const params = {
  kind: "modbus" as const,
  params: { host: "10.20.0.63", port: 8899, transport: "solarman-v5" as const },
};

/** A scanner where `answers` is the one unit id that is home (or none). */
function scanner(answers: number | null, log: number[] = []): () => Promise<UnitScanner> {
  return async () => ({
    probe: async (unitId: number) => {
      log.push(unitId);
      return unitId === answers;
    },
    close: async () => {},
  });
}

describe("scanUnitIds", () => {
  test("reports the unit id that answered, and every one it tried first", async () => {
    const tried: number[] = [];

    const result = await scanUnitIds({ ...params, profileId: "deye" }, scanner(2, tried));

    expect(result).toEqual({ scanned: [1, 0, 2], found: { unitId: 2, ms: expect.any(Number) } });
    // Stopped there: the next candidates were never asked.
    expect(tried).toEqual([1, 0, 2]);
  });

  test("tries 1 before 0 — the inverter's own slave address before broadcast", async () => {
    expect(DEFAULT_UNIT_CANDIDATES[0]).toBe(1);
    expect(DEFAULT_UNIT_CANDIDATES).toContain(0);
  });

  test("says so when nothing answers, naming every id it asked", async () => {
    const result = await scanUnitIds({ ...params, profileId: "deye" }, scanner(null));

    expect(result).toEqual({ scanned: [...DEFAULT_UNIT_CANDIDATES], found: null });
  });

  test("scans the candidates the caller names, in the order given", async () => {
    const tried: number[] = [];

    const result = await scanUnitIds(
      { ...params, profileId: "deye", candidates: [7, 3] },
      scanner(3, tried),
    );

    expect(tried).toEqual([7, 3]);
    expect(result.found).toMatchObject({ unitId: 3 });
  });

  test("refuses more candidates than one request may spend", async () => {
    // Every miss costs the full probe timeout on every framing (measured), so an
    // unbounded list is a request that never returns.
    const candidates = Array.from({ length: MAX_CANDIDATES + 1 }, (_, i) => i);

    await expect(
      scanUnitIds({ ...params, profileId: "deye", candidates }, scanner(null)),
    ).rejects.toThrow(/at most/);
  });

  test("refuses a duplicate candidate rather than probing it twice", async () => {
    expect(
      scanUnitIds({ ...params, profileId: "deye", candidates: [1, 1] }, scanner(null)),
    ).rejects.toThrow();
  });

  test("refuses a broker: there is no unit id on an MQTT connection", async () => {
    expect(
      scanUnitIds(
        { kind: "mqtt", params: { brokerUrl: "mqtt://hass.lan:1883" }, profileId: "deye" },
        scanner(null),
      ),
    ).rejects.toThrow();
  });

  test("closes the endpoint even when a probe throws", async () => {
    let closed = false;
    const open = async (): Promise<UnitScanner> => ({
      probe: () => Promise.reject(new Error("socket closed by peer")),
      close: async () => {
        closed = true;
      },
    });

    await expect(scanUnitIds({ ...params, profileId: "deye" }, open)).rejects.toThrow(
      "socket closed by peer",
    );
    expect(closed).toBe(true);
  });
});
