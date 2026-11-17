import { expect, test } from "bun:test";
import de from "../../messages/de.json";
import en from "../../messages/en.json";
import { isSigned, roleLabel, seriesName, sidesOf } from "./roles.ts";

test("a signed series' sides are named by its sign: the grid imports above, exports below", () => {
  expect(sidesOf("grid.power")).toEqual([
    { label: "Bezogen", colour: "var(--e-import)" },
    { label: "Eingespeist", colour: "var(--e-export)" },
  ]);
});

test("a battery charges above and discharges below, both in its own flow's colour", () => {
  expect(sidesOf("battery.power")).toEqual([
    { label: "Geladen", colour: "var(--e-battery)" },
    { label: "Entladen", colour: "var(--e-battery)" },
  ]);
});

test("only ADR 4's signed roles have sides; an indexed one by its role", () => {
  expect(isSigned("battery.power")).toBe(true);
  expect(isSigned("grid.phase.power[2]")).toBe(true);
  expect(isSigned("battery.temperature")).toBe(false);
  expect(sidesOf("grid.phase.power[2]")[0].label).toBe("Bezogen");
});

test("a signed series of no named sides is above and below zero", () => {
  expect(sidesOf("price.spot").map((s) => s.label)).toEqual(["Über null", "Unter null"]);
});

/** Every named role of ADR 4's table: `pv.mppt.power` / `.voltage` reads as `pv.mppt.voltage`. */
async function adrRoles(): Promise<string[]> {
  const adr = await Bun.file(
    new URL("../../../../docs/adr/0004-roles-and-conventions.md", import.meta.url),
  ).text();

  return adr
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .flatMap((line) => {
      let last = "";

      const names = (line.split("|")[1]!.match(/`[a-z.]+`/gu) ?? []).map((n) => n.slice(1, -1));

      return names.map((name) => {
        last = name.startsWith(".") ? last.replace(/\.[a-z]+$/u, name) : name;

        return last;
      });
    });
}

test.each(["de", "en"] as const)(
  "every named role of ADR 4 has a label of its own in %s",
  async (locale) => {
    const messages = Object.values({ de, en }[locale]);
    const roles = await adrRoles();

    expect(roles.length).toBeGreaterThan(60);

    const unlabelled = roles.filter((role) => {
      const label = roleLabel(role, locale);

      return label === role || !messages.includes(label);
    });

    expect(unlabelled).toEqual([]);
  },
);

test("a series is named by its role, its index, and an extra by its declared name", () => {
  expect(seriesName("battery.power")).toBe("Batterie · Leistung");
  expect(seriesName("pv.mppt.voltage[2]")).toBe("PV · Eingang 2 · Spannung");
  expect(seriesName("extra.Lüfter")).toBe("Lüfter");
});
