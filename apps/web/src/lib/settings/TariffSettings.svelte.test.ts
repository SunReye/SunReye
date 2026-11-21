import { afterEach, beforeEach, expect, test } from "vitest";
import { cdp, page, userEvent, type Locator } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect } from "../api/core.ts";
import { testCore } from "../tariff/tariff.harness.ts";
import TariffSettings from "./TariffSettings.svelte";
import { closed } from "../motion/animations.harness.ts";

/** The value editor's wheels land at once: a spring would turn on the browser's frames. */
beforeEach(async () => {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
});

afterEach(async () => {
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

/** A row's text as read, its spaces (no-break ones too) made plain. */
function text(row: Readonly<Locator>): string {
  return (row.element().textContent ?? "").replaceAll(/\s+/gu, " ").trim();
}

/** Opens the row named `row` in `scope`, types `value` into the value editor and applies it. */
async function enter(scope: Readonly<Locator>, row: string, value: string): Promise<void> {
  await userEvent.click(
    scope.getByRole("button", {
      name: new RegExp(`^${row.replaceAll(/[()/]/gu, String.raw`\$&`)}`, "u"),
    }),
  );
  await page.getByRole("button", { name: /tippen zum Eingeben/u }).click();
  await userEvent.fill(page.getByRole("textbox", { name: `${row} eingeben` }), value);
  await userEvent.keyboard("{Enter}");
  await page.getByRole("button", { name: /^Übernehmen/u }).click();
}

test("payback shows the savings against the investment, which the admin enters", async () => {
  let investment = 10_000;

  const core = testCore({
    "GET /api/v1/payback": () =>
      Response.json({ investment, savings: 0.62, remaining: investment - 0.62 }),
    "PUT /api/v1/investment": () => {
      investment = 12_000;

      return Response.json({ amount: investment });
    },
  });

  const screen = await render(TariffSettings, { core: connect(core) });
  const payback = screen.getByRole("region", { name: "Amortisation" });

  await expect.element(payback.getByRole("definition").nth(0)).toHaveTextContent("0,62 €");
  await expect.element(payback.getByRole("definition").nth(1)).toHaveTextContent("9.999,38 €");
  await expect
    .element(payback.getByRole("button", { name: /^Investition/u }))
    .toHaveTextContent("Investition 10.000,00 €");

  await userEvent.click(payback.getByRole("button", { name: /^Investition/u }));
  await page.getByRole("button", { name: /tippen zum Eingeben/u }).click();
  await userEvent.fill(page.getByRole("textbox", { name: "Investition (€) eingeben" }), "12000");
  await userEvent.keyboard("{Enter}");
  await page.getByRole("button", { name: /^Übernehmen/u }).click();

  await expect
    .element(payback.getByRole("button", { name: /^Investition/u }))
    .toHaveTextContent("Investition 12.000,00 €");
  await expect.element(payback.getByRole("definition").nth(1)).toHaveTextContent("11.999,38 €");
  expect(core.sent).toContainEqual({ route: "PUT /api/v1/investment", body: { amount: 12_000 } });
});

const WEEKNIGHTS = {
  appliesFrom: "2026-11-01T00:00:00Z",
  import: {
    price: 0.3,
    bands: [{ days: [1, 2, 3, 4, 5], from: "22:00", to: "24:00", price: 0.2 }],
  },
  export: { price: 0.08, bands: [] },
  standingCharge: 12,
};

test("the admin changes the tariff in force from now on", async () => {
  const core = testCore({
    "GET /api/v1/tariff": () => Response.json(WEEKNIGHTS),
    "PUT /api/v1/tariff": () => Response.json(WEEKNIGHTS),
  });

  const screen = await render(TariffSettings, { core: connect(core) });
  const bought = screen.getByRole("group", { name: "Bezug" });

  await expect
    .poll(() => text(bought.getByRole("button", { name: /^Basispreis \(ct\/kWh\)/u })))
    .toBe("Basispreis (ct/kWh) 30");
  await expect.element(bought.getByRole("checkbox", { name: "Fr" })).toBeChecked();
  await expect.element(bought.getByRole("checkbox", { name: "Sa" })).not.toBeChecked();
  await expect.element(bought.getByRole("button", { name: "Bis 24:00" })).toBeVisible();

  await enter(bought, "Basispreis (ct/kWh)", "31,5");
  await userEvent.click(bought.getByRole("checkbox", { name: "Sa" }));
  await userEvent.click(
    screen.getByRole("region", { name: "Tarif" }).getByRole("button", { name: "Speichern" }),
  );

  await expect
    .poll(() => core.sent.find(({ route }) => route === "PUT /api/v1/tariff")?.body)
    .toEqual({
      appliesFrom: null,
      import: {
        price: 0.315,
        bands: [{ days: [1, 2, 3, 4, 5, 6], from: "22:00", to: "24:00", price: 0.2 }],
      },
      export: { price: 0.08, bands: [] },
      standingCharge: 12,
    });
});

test("the admin sets the standing charge in euros a month", async () => {
  const core = testCore({
    "GET /api/v1/tariff": () => Response.json(WEEKNIGHTS),
    "PUT /api/v1/tariff": () => Response.json(WEEKNIGHTS),
  });

  const screen = await render(TariffSettings, { core: connect(core) });
  const tariff = screen.getByRole("region", { name: "Tarif" });

  await expect
    .poll(() => text(tariff.getByRole("button", { name: /^Grundpreis \(€\/Monat\)/u })))
    .toBe("Grundpreis (€/Monat) 12");

  await enter(tariff, "Grundpreis (€/Monat)", "16,5");
  await userEvent.click(tariff.getByRole("button", { name: "Speichern" }));

  await expect
    .poll(() => core.sent.find(({ route }) => route === "PUT /api/v1/tariff")?.body)
    .toMatchObject({ standingCharge: 16.5 });
});

/** Opens a band time on the value editor's wheels, turns the hour up and applies. */
async function wheelTo(group: string, field: string, hours: number, shows: string): Promise<void> {
  const fields = page.getByRole("group", { name: group });

  await userEvent.click(fields.getByRole("button", { name: field }));
  page.getByRole("spinbutton", { name: "Stunde" }).element().focus();

  await userEvent.keyboard("{ArrowUp}".repeat(hours));

  const apply = page.getByRole("button", { name: /^Übernehmen/u });

  expect(apply.element().textContent).toContain(`${String(hours).padStart(2, "0")}:00`);
  await userEvent.click(apply);
  await closed(apply);
  await expect.element(fields.getByRole("button", { name: shows })).toBeVisible();
}

test("the admin adds a band and reprices from a past date", async () => {
  const core = testCore({
    "GET /api/v1/tariff": () => Response.json(WEEKNIGHTS),
    "POST /api/v1/tariff/reprice": () => Response.json(WEEKNIGHTS),
  });

  const screen = await render(TariffSettings, { core: connect(core) });
  const fed = screen.getByRole("group", { name: "Einspeisung" });

  await expect
    .poll(() => text(fed.getByRole("button", { name: /^Basispreis \(ct\/kWh\)/u })))
    .toBe("Basispreis (ct/kWh) 8");

  await userEvent.click(fed.getByRole("button", { name: "Zeitfenster hinzufügen" }));
  await userEvent.click(fed.getByRole("checkbox", { name: "So" }));
  await wheelTo("Einspeisung", "Von 00:00", 10, "Von 10:00");
  // The end of the day reads 00:00 on the wheels, 24:00 in the band.
  await wheelTo("Einspeisung", "Bis 24:00", 14, "Bis 14:00");
  await enter(fed, "Preis (ct/kWh)", "0,5");

  // The first of this month on the calendar, from its midnight.
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const day = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, "0")}-01`;

  await userEvent.click(screen.getByRole("button", { name: /^Gilt ab/u }));
  await userEvent.click(page.elementLocator(document.querySelector(`[data-value="${day}"]`)!));
  await userEvent.click(screen.getByRole("button", { name: "Rückwirkend neu berechnen" }));

  await expect
    .poll(() => core.sent.find(({ route }) => route === "POST /api/v1/tariff/reprice")?.body)
    .toEqual({
      appliesFrom: first.toISOString(),
      import: WEEKNIGHTS.import,
      export: { price: 0.08, bands: [{ days: [7], from: "10:00", to: "14:00", price: 0.005 }] },
      standingCharge: 12,
    });
});

test("a tariff the core refuses shows why", async () => {
  const core = testCore({
    "GET /api/v1/tariff": () => Response.json(WEEKNIGHTS),
    "PUT /api/v1/tariff": () =>
      Response.json(
        { status: 422, code: "tariff.band" },
        { status: 422, headers: { "content-type": "application/problem+json" } },
      ),
  });

  const screen = await render(TariffSettings, { core: connect(core) });
  const bought = screen.getByRole("group", { name: "Bezug" });

  await expect
    .poll(() => text(bought.getByRole("button", { name: /^Basispreis \(ct\/kWh\)/u })))
    .toBe("Basispreis (ct/kWh) 30");

  await userEvent.click(
    screen.getByRole("region", { name: "Tarif" }).getByRole("button", { name: "Speichern" }),
  );

  await expect
    .element(screen.getByRole("region", { name: "Tarif" }).getByRole("alert"))
    .toBeVisible();
});

test("the admin chooses the bidding zone spot prices are fetched for", async () => {
  const core = testCore({
    "GET /api/v1/spot-prices": () => Response.json({ zone: null }),
    "PUT /api/v1/spot-prices": () => Response.json({ zone: "DE-LU" }),
  });

  const screen = await render(TariffSettings, { core: connect(core) });
  const zone = screen.getByRole("group", { name: "Gebotszone" });

  await expect.element(zone.getByRole("radio", { name: "Keine" })).toBeChecked();

  await userEvent.click(zone.getByRole("radio", { name: "DE-LU" }));

  await expect
    .poll(() => core.sent.find(({ route }) => route === "PUT /api/v1/spot-prices")?.body)
    .toEqual({ zone: "DE-LU" });
});
