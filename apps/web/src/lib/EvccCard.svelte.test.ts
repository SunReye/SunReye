import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import EvccCard from "./EvccCard.svelte";

test("a charging loadpoint shows its power, the vehicle's SOC and the session's energy", async () => {
  const values = {
    "ev.charge.power": 11040,
    "ev.vehicle.soc": 63,
    "ev.session.energy": 4.5,
    "ev.connected": 1,
    "ev.charging": 1,
  };

  const card = await render(EvccCard, { values });

  await expect.element(card.getByRole("heading", { name: "Ladepunkt" })).toBeVisible();
  await expect.element(card.getByText("Lädt")).toBeVisible();
  await expect.element(card.getByText("11.040 W")).toBeVisible();
  await expect.element(card.getByText("63 %")).toBeVisible();
  await expect.element(card.getByText("4,5 kWh")).toBeVisible();
});

test("an empty loadpoint says so and shows no vehicle SOC", async () => {
  const values = {
    "ev.charge.power": 0,
    "ev.session.energy": 0,
    "ev.connected": 0,
    "ev.charging": 0,
  };

  const card = await render(EvccCard, { values });

  await expect.element(card.getByText("Kein Fahrzeug")).toBeVisible();
  await expect.element(card.getByText("Fahrzeug-SOC")).not.toBeInTheDocument();
});

test("a plugged-in vehicle that does not charge is connected", async () => {
  const values = { "ev.charge.power": 0, "ev.connected": 1, "ev.charging": 0 };

  const card = await render(EvccCard, { values });

  await expect.element(card.getByText("Angesteckt")).toBeVisible();
});
