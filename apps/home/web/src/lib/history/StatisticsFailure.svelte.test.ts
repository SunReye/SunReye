import { afterEach, expect, test } from "vitest";
// The screen is laid out by the SPA's utilities.
import "../../app.css";
import { realTimers } from "../motion/clock.harness.ts";
import { plant, reset, show, YESTERDAY, zone } from "./statistics.harness.ts";

// A read that fails, lost or refused, says so with a retry; a refusal says the core's reason too,
// and never reads as an empty range (ADR 21).

afterEach(() => {
  realTimers();
  reset();
});

const DAY = `range=day&at=${YESTERDAY}`;

test("a failed read says so and loads again on request", async () => {
  plant.broken = true;

  const { screen } = await show(DAY);

  await expect
    .element(screen.getByRole("alert").getByText("Der Verlauf konnte nicht geladen werden"))
    .toBeVisible();

  // The plant's zone moves the range once; that read fails too.
  await expect.poll(() => zone.read).toBe(true);
  await expect.element(screen.getByRole("alert")).toBeVisible();

  plant.broken = false;
  await screen.getByRole("button", { name: "Erneut laden" }).click();

  await expect.element(screen.getByText(/^Gestern hat die Anlage/u)).toBeVisible();
});

test("a refused read is failed too: it says the core's reason, never an empty range", async () => {
  plant.refused = "history.range";

  const { screen } = await show(DAY);
  const failed = screen.getByRole("alert");

  await expect.element(failed.getByText("Der Verlauf konnte nicht geladen werden")).toBeVisible();
  await expect.element(failed.getByText("Dieser Zeitraum ist leer oder zu lang.")).toBeVisible();

  plant.refused = null;
  await failed.getByRole("button", { name: "Erneut laden" }).click();

  await expect.element(screen.getByText(/^Gestern hat die Anlage/u)).toBeVisible();
});
