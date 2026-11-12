import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect, type Transport } from "../api/core.ts";
import SettingsScreen from "./SettingsScreen.svelte";
import { attempt, CAPABILITIES, CHARGE, problem, row, testCore } from "./settings.harness.ts";

test("each setting renders from the device's capabilities", async () => {
  const screen = await render(SettingsScreen, {
    core: connect(testCore(() => Response.json({ writes: [] }))),
  });

  await userEvent.click(screen.getByRole("button", row(CHARGE)));
  const charge = page.getByRole("spinbutton", { name: CHARGE });

  await expect.element(charge).toHaveAttribute("aria-valuemin", "0");
  await expect.element(charge).toHaveAttribute("aria-valuemax", "350");
  await userEvent.keyboard("{Escape}");

  await userEvent.click(screen.getByRole("button", row("work_mode")));
  const mode = page.getByRole("radiogroup", { name: "work_mode" });

  await expect.element(mode.getByRole("radio", { name: "0" })).toBeChecked();
  expect(mode.getByRole("radio").elements()).toHaveLength(3);
});

test("the admin sees the write log", async () => {
  const log = { writes: [attempt({ outcome: "mismatch", after: 108 })] };

  const screen = await render(SettingsScreen, {
    core: connect(testCore(() => Response.json(log))),
  });

  const table = screen.getByRole("table", { name: "Schreibprotokoll" });

  await expect.element(table).toBeVisible();
  await expect.element(table.getByRole("cell", { name: CHARGE })).toBeVisible();
  await expect.element(table.getByRole("cell", { name: /^Abweichend/u })).toBeVisible();
});

test("without the admin's session the write log is not shown", async () => {
  const screen = await render(SettingsScreen, {
    core: connect(testCore(() => problem(401, "auth.required"))),
  });

  await expect.element(screen.getByRole("button", row(CHARGE))).toBeVisible();
  expect(screen.getByRole("table", { name: "Schreibprotokoll" }).query()).toBeNull();
});

test("a device whose writes are off says so and offers no write", async () => {
  const off = structuredClone(CAPABILITIES);
  off.devices["3"].writes = false;

  const transport: Transport = {
    base: "http://core.test/",
    fetch: (request) =>
      Promise.resolve(
        request.url.endsWith("/capabilities")
          ? Response.json(off)
          : Response.json({ writes: [], updates: [] }),
      ),
  };

  const screen = await render(SettingsScreen, { core: connect(transport) });

  await expect
    .element(screen.getByText(/Schreiben ist für dieses Gerät ausgeschaltet/u))
    .toBeVisible();
  await expect.element(screen.getByRole("button", row(CHARGE))).toBeDisabled();
});

test("a setting that needs the admin's enable shows its bounds and is enabled in one click", async () => {
  const off = structuredClone(CAPABILITIES);
  const charge = off.devices["3"].settings[0];

  if (charge) charge.enable = "off";

  let capabilities = off;

  const transport = testCore(
    () => Response.json({ writes: [] }),
    () => {
      capabilities = CAPABILITIES;

      return new Response(null, { status: 204 });
    },
    { "/api/v1/capabilities": () => Response.json(capabilities) },
  );

  const screen = await render(SettingsScreen, { core: connect(transport) });

  await expect
    .element(screen.getByText("Nicht auf Hardware geprüft: wird erst nach Freigabe geschrieben."))
    .toBeVisible();
  await expect.element(screen.getByText("Erlaubt: 0 bis 350, Schritt 1")).toBeVisible();
  await expect.element(screen.getByRole("button", row(CHARGE))).toBeDisabled();

  await userEvent.click(screen.getByRole("button", { name: `${CHARGE} freigeben` }));

  expect(transport.writes).toEqual([`PUT /api/v1/devices/3/settings/${CHARGE}/enabled `]);
  await expect.element(screen.getByRole("button", row(CHARGE))).toBeEnabled();
  await expect
    .element(screen.getByRole("button", { name: `Freigabe von ${CHARGE} zurücknehmen` }))
    .toBeVisible();
});

test("an update shows what it changes and is applied in one click", async () => {
  const update = {
    id: "box",
    from: "1.0.0",
    to: "1.1.0",
    settings: [
      {
        key: CHARGE,
        change: "changed",
        before: { range: { min: 0, max: 350 }, step: 1 },
        after: { range: { min: 0, max: 400 }, step: 1 },
      },
      { key: "work_mode", change: "removed", before: { values: [0, 1, 2], step: 1 }, after: null },
    ],
    quantities: [{ key: "battery.power", change: "added" }],
  };

  let updates = [update];

  const transport = testCore(
    () => Response.json({ writes: [] }),
    () => {
      updates = [];

      return Response.json(update);
    },
    { "/api/v1/profile-updates": () => Response.json({ updates }) },
  );

  const screen = await render(SettingsScreen, { core: connect(transport) });

  const diff = screen.getByRole("table", { name: "box: 1.0.0 → 1.1.0" });
  await expect.element(diff).toBeVisible();
  const charge = diff.getByRole("row", { name: new RegExp(CHARGE, "u") });
  await expect
    .element(charge)
    .toHaveTextContent(`${CHARGE}geändert0 bis 350, Schritt 10 bis 400, Schritt 1`);
  await expect
    .element(diff.getByRole("row", { name: /work_mode/u }))
    .toHaveTextContent("work_modeentferntWerte 0, 1, 2–");
  await expect
    .element(diff.getByRole("row", { name: /battery\.power/u }))
    .toHaveTextContent("battery.powerhinzugefügt");

  await userEvent.click(screen.getByRole("button", { name: "Update für box anwenden" }));

  expect(transport.writes).toEqual(["POST /api/v1/profile-updates/box "]);
  await expect.element(diff).not.toBeInTheDocument();
});
