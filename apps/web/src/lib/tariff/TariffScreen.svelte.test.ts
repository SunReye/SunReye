import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import TariffScreen from "./TariffScreen.svelte";

type Answer = () => Response;

interface Sent {
  /** The method, path and query. */
  readonly route: string;
  readonly body: unknown;
}

interface TestCore extends Transport {
  readonly sent: readonly Sent[];
}

const SNAPSHOT = {
  devices: {
    "4294967293": { "price.import": 0.3, "price.export": 0.08, "cost.savings.rate": 0.1 },
    "4294967292": { "price.spot": 0.1234 },
  },
};

const STREAM = `event: snapshot\ndata: ${JSON.stringify(SNAPSHOT)}\n\n`;

/** A test core answering `routes` by method and path; the live stream sends one snapshot. */
function testCore(routes: Readonly<Record<string, Answer>>): TestCore {
  const sent: Sent[] = [];
  let streamed = false;

  function live(): Promise<Response> {
    if (streamed) return Promise.withResolvers<Response>().promise;

    streamed = true;

    return Promise.resolve(
      new Response(STREAM, { headers: { "content-type": "text/event-stream" } }),
    );
  }

  return {
    base: "http://core.test/",
    sent,
    fetch: async (request) => {
      const { pathname, search } = new URL(request.url);
      const route = `${request.method} ${pathname}`;
      const text = await request.text();

      sent.push({ route: route + search, body: text === "" ? undefined : JSON.parse(text) });

      return pathname === "/api/v1/live" ? live() : (routes[route]?.() ?? forbidden());
    },
  };
}

function forbidden(): Response {
  return Response.json(
    { status: 403, code: "auth.forbidden" },
    { status: 403, headers: { "content-type": "application/problem+json" } },
  );
}

test("the prices in force show in ct/kWh, the spot price with its attribution", async () => {
  const screen = await render(TariffScreen, { core: connect(testCore({})) });

  await expect
    .element(screen.getByRole("definition").filter({ hasText: "30,00 ct/kWh" }))
    .toBeVisible();
  await expect.element(screen.getByText("8,00 ct/kWh")).toBeVisible();
  await expect.element(screen.getByText("12,34 ct/kWh")).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: "CC BY 4.0" }))
    .toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
});

const COSTS = {
  days: [
    {
      start: "2026-11-01T00:00:00Z",
      end: "2026-11-02T00:00:00Z",
      paid: 0,
      earned: 0.32,
      saved: 0.62,
    },
    {
      start: "2026-11-02T00:00:00Z",
      end: "2026-11-03T00:00:00Z",
      paid: 0.3,
      earned: 0,
      saved: 0.15,
    },
  ],
  total: { paid: 0.3, earned: 0.32, saved: 0.77 },
};

test("each day's costs show with the total the core serves", async () => {
  const core = testCore({ "GET /api/v1/costs": () => Response.json(COSTS) });

  const screen = await render(TariffScreen, { core: connect(core) });

  const day = screen.getByRole("row").filter({ hasText: "01.11.2026" }).getByRole("cell");
  const total = screen.getByRole("row").filter({ hasText: "Summe" }).getByRole("cell");

  await expect.element(day.nth(0)).toHaveTextContent("0,00 €");
  await expect.element(day.nth(1)).toHaveTextContent("0,32 €");
  await expect.element(day.nth(2)).toHaveTextContent("0,62 €");
  await expect.element(total.nth(0)).toHaveTextContent("0,30 €");
  await expect.element(total.nth(1)).toHaveTextContent("0,32 €");
  await expect.element(total.nth(2)).toHaveTextContent("0,77 €");

  const asked = core.sent.find(({ route }) => route.startsWith("GET /api/v1/costs"));
  const query = new URLSearchParams(asked?.route.split("?")[1]);
  // The last 31 days, so a month shows whole.
  expect(Date.parse(query.get("to") ?? "") - Date.parse(query.get("from") ?? "")).toBe(
    31 * 86_400_000,
  );
});

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

  const screen = await render(TariffScreen, { core: connect(core) });
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

  const screen = await render(TariffScreen, { core: connect(core) });
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

  const screen = await render(TariffScreen, { core: connect(core) });
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

  const screen = await render(TariffScreen, { core: connect(core) });
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

  const screen = await render(TariffScreen, { core: connect(core) });
  const zone = screen.getByRole("combobox", { name: "Gebotszone" });

  await expect.element(zone).toHaveValue("");

  await userEvent.selectOptions(zone, "DE-LU");

  await expect
    .poll(() => core.sent.find(({ route }) => route === "PUT /api/v1/spot-prices")?.body)
    .toEqual({ zone: "DE-LU" });
});
