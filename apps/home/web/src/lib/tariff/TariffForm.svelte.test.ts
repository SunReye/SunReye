import { toast } from "svelte-sonner";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { connect } from "../api/core.ts";
import { testCore } from "./tariff.harness.ts";
import TariffForm from "./TariffForm.svelte";
import { json } from "../api/core.harness.ts";

const TARIFF = {
  appliesFrom: "2026-11-13T12:00:00Z",
  import: { price: 0.3, bands: [] },
  export: { price: 0.08, bands: [] },
  standingCharge: 0,
};

afterEach(() => {
  vi.restoreAllMocks();
});

test("a saved tariff is confirmed by a toast, not by a line under the form", async () => {
  const success = vi.spyOn(toast, "success");

  const core = testCore({
    "PUT /api/v1/tariff": () => json("Tariff", TARIFF),
  });

  const screen = await render(TariffForm, { core: connect(core), tariff: TARIFF });

  await screen.getByRole("button", { name: "Speichern" }).click();

  await expect.poll(() => success.mock.calls.length).toBe(1);
  expect(success.mock.calls[0]?.[0]).toMatch(/^Gespeichert, gilt ab /u);
  expect(screen.getByRole("status").query()).toBeNull();
});

test("a refused tariff is said beside the form, where it is fixed", async () => {
  const success = vi.spyOn(toast, "success");
  const screen = await render(TariffForm, { core: connect(testCore({})), tariff: TARIFF });

  await screen.getByRole("button", { name: "Speichern" }).click();

  await expect.element(screen.getByRole("alert")).toBeVisible();
  expect(success).not.toHaveBeenCalled();
});
