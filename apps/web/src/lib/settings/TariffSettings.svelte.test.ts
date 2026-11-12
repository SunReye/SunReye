import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect } from "../api/core.ts";
import { testCore } from "../tariff/tariff.harness.ts";
import TariffSettings from "./TariffSettings.svelte";

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

  await expect.element(payback.getByRole("definition").nth(1)).toHaveTextContent("0,62 €");
  await expect.element(payback.getByRole("definition").nth(2)).toHaveTextContent("9.999,38 €");

  await userEvent.fill(payback.getByRole("spinbutton", { name: "Investition (€)" }), "12000");
  await userEvent.click(payback.getByRole("button", { name: "Speichern" }));

  await expect.element(payback.getByRole("definition").nth(0)).toHaveTextContent("12.000,00 €");
  await expect.element(payback.getByRole("definition").nth(2)).toHaveTextContent("11.999,38 €");
  expect(core.sent).toContainEqual({ route: "PUT /api/v1/investment", body: { amount: 12_000 } });
});

const WEEKNIGHTS = {
  appliesFrom: "2026-11-01T00:00:00Z",
  import: {
    price: 0.3,
    bands: [{ days: [1, 2, 3, 4, 5], from: "22:00", to: "24:00", price: 0.2 }],
  },
  export: { price: 0.08, bands: [] },
};

test("the admin changes the tariff in force from now on", async () => {
  const core = testCore({
    "GET /api/v1/tariff": () => Response.json(WEEKNIGHTS),
    "PUT /api/v1/tariff": () => Response.json(WEEKNIGHTS),
  });

  const screen = await render(TariffSettings, { core: connect(core) });
  const bought = screen.getByRole("group", { name: "Bezug" });

  await expect
    .element(bought.getByRole("spinbutton", { name: "Grundpreis (ct/kWh)" }))
    .toHaveValue(30);
  await expect.element(bought.getByRole("checkbox", { name: "Fr" })).toBeChecked();
  await expect.element(bought.getByRole("checkbox", { name: "Sa" })).not.toBeChecked();
  await expect.element(bought.getByRole("textbox", { name: "Bis" })).toHaveValue("24:00");

  await userEvent.fill(bought.getByRole("spinbutton", { name: "Grundpreis (ct/kWh)" }), "31.5");
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
    });
});

test("the admin adds a band and reprices from a past date", async () => {
  const core = testCore({
    "GET /api/v1/tariff": () => Response.json(WEEKNIGHTS),
    "POST /api/v1/tariff/reprice": () => Response.json(WEEKNIGHTS),
  });

  const screen = await render(TariffSettings, { core: connect(core) });
  const fed = screen.getByRole("group", { name: "Einspeisung" });

  await expect.element(fed.getByRole("spinbutton", { name: "Grundpreis (ct/kWh)" })).toHaveValue(8);

  await userEvent.click(fed.getByRole("button", { name: "Zeitfenster hinzufügen" }));
  await userEvent.click(fed.getByRole("checkbox", { name: "So" }));
  await userEvent.fill(fed.getByRole("textbox", { name: "Von" }), "10:00");
  await userEvent.fill(fed.getByRole("textbox", { name: "Bis" }), "14:00");
  await userEvent.fill(fed.getByRole("spinbutton", { name: "Preis (ct/kWh)" }), "0");
  await userEvent.fill(screen.getByLabelText("Gilt ab"), "2026-10-01T00:00");
  await userEvent.click(screen.getByRole("button", { name: "Rückwirkend neu berechnen" }));

  await expect
    .poll(() => core.sent.find(({ route }) => route === "POST /api/v1/tariff/reprice")?.body)
    .toEqual({
      appliesFrom: new Date(2026, 9, 1).toISOString(),
      import: WEEKNIGHTS.import,
      export: { price: 0.08, bands: [{ days: [7], from: "10:00", to: "14:00", price: 0 }] },
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
    .element(bought.getByRole("spinbutton", { name: "Grundpreis (ct/kWh)" }))
    .toHaveValue(30);

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
  const zone = screen.getByRole("combobox", { name: "Gebotszone" });

  await expect.element(zone).toHaveValue("");

  await userEvent.selectOptions(zone, "DE-LU");

  await expect
    .poll(() => core.sent.find(({ route }) => route === "PUT /api/v1/spot-prices")?.body)
    .toEqual({ zone: "DE-LU" });
});
