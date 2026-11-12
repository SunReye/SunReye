import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect } from "../api/core.ts";
import SettingsScreen from "./SettingsScreen.svelte";
import { attempt, CAPABILITIES, CHARGE, problem, row, testCore } from "./settings.harness.ts";

test("an enumerated setting shows each value by its label", async () => {
  const enabled = structuredClone(CAPABILITIES);
  const mode = enabled.devices["3"].settings[2];

  if (mode) mode.enable = "on";

  const screen = await render(SettingsScreen, {
    core: connect(
      testCore(() => Response.json({ writes: [] }), undefined, {
        "/api/v1/capabilities": () => Response.json(enabled),
      }),
    ),
  });

  await userEvent.click(screen.getByRole("button", row("ev.mode")));
  const list = page.getByRole("radiogroup", { name: "ev.mode" });

  await expect.element(list.getByRole("radio", { name: "minpv" })).toBeInTheDocument();
  expect(list.getByRole("radio", { name: "2" }).elements()).toHaveLength(0);
});

test("a setting awaiting its enable lists its values by their labels", async () => {
  const screen = await render(SettingsScreen, {
    core: connect(testCore(() => Response.json({ writes: [] }))),
  });

  await expect
    .element(screen.getByText("Erlaubt: Werte off, now, minpv, pv", { exact: false }))
    .toBeVisible();
});

test("a write shows its outcome and the step that failed", async () => {
  const transport = testCore(
    () => Response.json({ writes: [] }),
    () => Response.json(attempt({ outcome: "partial", after: null, failedStep: 2 })),
  );

  const screen = await render(SettingsScreen, { core: connect(transport) });

  await userEvent.click(screen.getByRole("button", row(CHARGE)));
  await userEvent.click(page.getByRole("button", { name: /tippen zum Eingeben/u }));
  await userEvent.fill(page.getByRole("textbox", { name: `${CHARGE} eingeben` }), "50");
  await userEvent.keyboard("{Enter}");
  await userEvent.click(page.getByRole("button", { name: /^Übernehmen/u }));

  const alert = page.getByRole("alert");

  await expect.element(alert.getByText("Abweichung.")).toBeVisible();
  await expect
    .element(
      alert.getByText(
        "Teilweise geschrieben: Der Zustand des Geräts ist ungewiss. Fehlgeschlagen bei Schritt 2.",
        { exact: false },
      ),
    )
    .toBeVisible();
  expect(transport.writes).toEqual([`PUT /api/v1/devices/3/settings/${CHARGE} {"value":50}`]);
});

test("a verified write closes the editor and the row shows the value read back", async () => {
  const transport = testCore(() => Response.json({ writes: [] }));
  const screen = await render(SettingsScreen, { core: connect(transport) });

  await userEvent.click(screen.getByRole("button", row(CHARGE)));
  page.getByRole("spinbutton", { name: CHARGE }).element().focus();
  await userEvent.keyboard("{PageUp}{PageUp}{PageUp}{PageUp}{PageUp}");
  await expect
    .element(page.getByRole("spinbutton", { name: CHARGE }))
    .toHaveAttribute("aria-valuenow", "50");
  await userEvent.click(page.getByRole("button", { name: /^Übernehmen/u }));

  expect(transport.writes).toEqual([`PUT /api/v1/devices/3/settings/${CHARGE} {"value":50}`]);
  await expect.element(page.getByRole("spinbutton")).not.toBeInTheDocument();
  await expect.element(screen.getByRole("status")).toHaveTextContent("Geschrieben und bestätigt.");
  await expect.element(screen.getByRole("button", row(CHARGE, "50"))).toBeVisible();
});

test("a refused write shows its problem", async () => {
  const screen = await render(SettingsScreen, {
    core: connect(
      testCore(
        () => Response.json({ writes: [] }),
        () => problem(429, "setting.interval"),
      ),
    ),
  });

  await userEvent.click(screen.getByRole("button", row("work_mode")));
  await userEvent.click(page.getByRole("radio", { name: "2" }));
  await userEvent.click(page.getByRole("button", { name: /^Übernehmen/u }));

  const alert = page.getByRole("alert");

  await expect.element(alert.getByText("Abgelehnt.")).toBeVisible();
  await expect
    .element(
      alert.getByText(
        "Diese Einstellung wurde eben erst geschrieben; warte ihren Mindestabstand ab.",
        { exact: false },
      ),
    )
    .toBeVisible();
});
