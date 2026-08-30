import { describe, expect, test } from "bun:test";
import type { PlantDb } from "@SunReye/db/plant-repo";
import {
  MissingMqttNamespaceError,
  type NamespaceDevice,
  type NamespacePlant,
  readMqttNamespace,
  resolveMqttNamespace,
} from "./mqtt-namespace";

const plant: NamespacePlant = { id: 1, slug: "haus-sud" };

const device = (over: Partial<NamespaceDevice> = {}): NamespaceDevice => ({
  id: 1,
  slug: "inverter",
  profileId: "deye-sg05lp3",
  role: "inverter",
  ...over,
});

describe("resolveMqttNamespace", () => {
  test("the plant's slug and the device that carries the active profile", () => {
    expect(
      resolveMqttNamespace(
        plant,
        [device({ id: 2, slug: "inverter-2", profileId: "sofar" })],
        "sofar",
      ),
    ).toEqual({ plantSlug: "haus-sud", deviceSlug: "inverter-2" });
  });

  test("a profile SWAP still names the same device — that is the whole point", () => {
    // Right after a swap no device carries the new profile id (provisioning
    // re-points the row on the next boot). Falling through to an error would take
    // the bridge down; inventing a slug would rename every entity.
    expect(resolveMqttNamespace(plant, [device()], "sofar-hyd-6000")).toEqual({
      plantSlug: "haus-sud",
      deviceSlug: "inverter",
    });
  });

  test("the profile id wins over the role when both could match", () => {
    const devices = [
      device({ id: 1, slug: "inverter", profileId: "old" }),
      device({ id: 2, slug: "inverter-2", profileId: "deye-sg05lp3" }),
    ];
    expect(resolveMqttNamespace(plant, devices, "deye-sg05lp3").deviceSlug).toBe("inverter-2");
  });

  test("the lowest-id inverter wins, so row order cannot move the namespace", () => {
    const devices = [
      device({ id: 7, slug: "inverter-b", profileId: "x" }),
      device({ id: 3, slug: "inverter-a", profileId: "x" }),
    ];
    expect(resolveMqttNamespace(plant, devices, "none").deviceSlug).toBe("inverter-a");
  });

  test("a controller or a meter is never adopted as the inverter's namespace", () => {
    // A controller's slug would make every inverter reading claim to come from the
    // controller — permanently, because the slug is frozen.
    const devices = [
      device({ role: "controller", slug: "gx" }),
      device({ role: "meter", slug: "meter" }),
    ];
    expect(() => resolveMqttNamespace(plant, devices, "none")).toThrow(MissingMqttNamespaceError);
  });

  test("an OPTIMIZER is never the namespace, not even by profile id", () => {
    // The virtual device publishes nothing of its own, and the bridge's topics
    // carry the INVERTER's readings. Arm 1 matches on profile id alone, so an
    // optimizer sharing it would silently take the namespace over — and slugs
    // are frozen, so the wrong topic tree would be permanent.
    const devices = [
      device({ id: 1, role: "optimizer", slug: "optimizer", profileId: "deye-sg05lp3" }),
      device({ id: 2, slug: "inverter-2", profileId: "other" }),
    ];
    expect(resolveMqttNamespace(plant, devices, "deye-sg05lp3").deviceSlug).toBe("inverter-2");
  });

  test("a plant of nothing but an optimizer has no namespace at all", () => {
    const devices = [device({ role: "optimizer", slug: "optimizer" })];
    expect(() => resolveMqttNamespace(plant, devices, "none")).toThrow(MissingMqttNamespaceError);
  });

  test("no plant at all is an error, never a guessed namespace", () => {
    expect(() => resolveMqttNamespace(null, [device()], "x")).toThrow(MissingMqttNamespaceError);
  });

  test("a plant with no devices is an error", () => {
    expect(() => resolveMqttNamespace(plant, [], "x")).toThrow(MissingMqttNamespaceError);
  });

  test("an empty or blank slug is refused — `<prefix>//<topic>` is not a topic", () => {
    expect(() => resolveMqttNamespace({ id: 1, slug: "" }, [device()], "x")).toThrow(
      MissingMqttNamespaceError,
    );
    expect(() => resolveMqttNamespace({ id: 1, slug: "   " }, [device()], "x")).toThrow(
      MissingMqttNamespaceError,
    );
    expect(() => resolveMqttNamespace(plant, [device({ slug: "  " })], "x")).toThrow(
      MissingMqttNamespaceError,
    );
  });

  test("a blank slug on the profile-matched device falls through to the inverter arm", () => {
    const devices = [
      device({ id: 1, slug: " ", profileId: "deye-sg05lp3" }),
      device({ id: 2, slug: "inverter-2", profileId: "other" }),
    ];
    expect(resolveMqttNamespace(plant, devices, "deye-sg05lp3").deviceSlug).toBe("inverter-2");
  });

  test("each error names the install state it found, so the log is actionable", () => {
    expect(() => resolveMqttNamespace(null, [], "x")).toThrow(/no plant row/);
    expect(() => resolveMqttNamespace(plant, [], "x")).toThrow(/no device row/);
  });
});

// ---------------------------------------------------------------------------
// The read. A fake client, so the ROW SHAPE the repository hands back is what
// reaches the pure resolver — a hand-built object would prove nothing about it.
// ---------------------------------------------------------------------------

const plantRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: "Haus Süd",
  slug: "haus-sud",
  timeZone: "Europe/Berlin",
  latitude: null,
  longitude: null,
  label: "",
  arrays: [],
  tempCoefficient: -0.4,
  systemLoss: 14,
  maxOutputW: null,
  houseLoadW: null,
  smartMeterSince: null,
  biddingZone: null,
  tariffKey: null,
  ...over,
});

const deviceRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  slug: "inverter",
  name: "Deye SG05LP3",
  profileId: "deye-sg05lp3",
  role: "inverter",
  unitId: 1,
  connectionId: 1,
  retiredAt: null,
  ...over,
});

/**
 * Flatten a drizzle `SQL` back to its literal text.
 *
 * The chunks are a tree of `StringChunk`s (whose `value` is a string array) and
 * bound `Param`s; the literals are what the retired-device assertion below needs,
 * and a bare `String(sql)` yields "[object Object]".
 */
function sqlText(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks;
  if (!chunks) return "";
  return chunks
    .map((chunk) => {
      const value = (chunk as { value?: unknown }).value;
      if (Array.isArray(value)) return value.join("");
      if (typeof value === "string") return value;
      return sqlText(chunk);
    })
    .join(" ");
}

/** Records the statements, and answers plant vs device reads BY ORDER. */
function fakeDb(plants: unknown[], devices: unknown[]): PlantDb & { sql: string[] } {
  const seen: string[] = [];
  return {
    sql: seen,
    execute: async (query) => {
      seen.push(sqlText(query));
      return { rows: seen.length === 1 ? plants : devices };
    },
  };
}

describe("readMqttNamespace", () => {
  test("reads the plant, then that plant's devices", async () => {
    const database = fakeDb([plantRow()], [deviceRow()]);
    expect(await readMqttNamespace("deye-sg05lp3", database)).toEqual({
      plantSlug: "haus-sud",
      deviceSlug: "inverter",
    });
    expect(database.sql).toHaveLength(2);
  });

  test("no plant short-circuits without asking for devices", async () => {
    const database = fakeDb([], [deviceRow()]);
    await expect(readMqttNamespace("x", database)).rejects.toThrow(MissingMqttNamespaceError);
    expect(database.sql).toHaveLength(1);
  });

  test("a plant whose only device is retired is refused, not adopted", async () => {
    // Proven through the STATEMENT: `includeRetired: false` narrows the query, so
    // the retired row never comes back at all.
    const database = fakeDb([plantRow()], []);
    await expect(readMqttNamespace("deye-sg05lp3", database)).rejects.toThrow(/no device row/);
    expect(database.sql.at(-1)).toContain("retired_at is null");
  });
});
