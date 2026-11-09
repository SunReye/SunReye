import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type Attempt, type Transport } from "../api/core.ts";
import SettingsScreen from "./SettingsScreen.svelte";

const CHARGE = "battery.max_charge_current";

/** A profile's settings as the core's capabilities list them; no brand anywhere. */
const CAPABILITIES = {
  version: "5.0.0",
  schema: { min: 1, max: 1 },
  capabilities: [],
  transports: [],
  devices: {
    "3": {
      estimated: [],
      writes: true,
      settings: [
        { key: CHARGE, range: { min: 0, max: 350 }, step: 1, enable: "on" },
        { key: "work_mode", values: [0, 1, 2], step: 1, enable: "on" },
        {
          key: "ev.mode",
          values: [0, 1, 2, 3],
          labels: [
            { value: 0, text: "off" },
            { value: 1, text: "now" },
            { value: 2, text: "minpv" },
            { value: 3, text: "pv" },
          ],
          step: 1,
          enable: "community",
        },
      ],
    },
  },
};

function attempt(fields: Readonly<Partial<Attempt>>): Attempt {
  return {
    time: "2026-11-09T08:00:00Z",
    device: 3,
    setting: CHARGE,
    before: 108,
    requested: 50,
    after: 50,
    outcome: "verified",
    failedStep: null,
    actor: "admin",
    ...fields,
  };
}

function problem(status: number, code: string): Response {
  return Response.json(
    { status, code },
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

/** A test core: capabilities as above, the write log and each write answered by the test. */
function testCore(
  log: () => Response,
  write: () => Response = () => Response.json(attempt({})),
  read: Readonly<Record<string, () => Response>> = {},
): Transport & { readonly writes: string[] } {
  const writes: string[] = [];

  return {
    base: "http://core.test/",
    writes,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      const answer = request.method === "GET" ? read[path] : undefined;

      if (answer !== undefined) return answer();

      if (path === "/api/v1/capabilities") return Response.json(CAPABILITIES);

      if (path === "/api/v1/writes") return log();

      if (path === "/api/v1/profile-updates") return Response.json({ updates: [] });

      // No import has run, and none is offered.
      if (path === "/api/v1/import") return Response.json({ state: "idle", done: 0, total: 0 });

      if (path === "/api/v1/import/files") return Response.json({ files: [] });

      writes.push(`${request.method} ${path} ${await request.text()}`);

      return write();
    },
  };
}

test("each setting renders from the device's capabilities", async () => {
  const screen = await render(SettingsScreen, {
    core: connect(testCore(() => Response.json({ writes: [] }))),
  });

  const charge = screen.getByRole("spinbutton", { name: CHARGE });

  await expect.element(charge).toHaveAttribute("min", "0");
  await expect.element(charge).toHaveAttribute("max", "350");
  await expect.element(charge).toHaveAttribute("step", "1");
  const mode = screen.getByRole("combobox", { name: "work_mode" });

  await expect.element(mode).toHaveValue("0");
  expect(mode.getByRole("option").elements()).toHaveLength(3);
  await expect.element(mode.getByRole("option", { name: "2" })).toBeInTheDocument();
});

test("an enumerated setting shows each value by its label", async () => {
  const screen = await render(SettingsScreen, {
    core: connect(testCore(() => Response.json({ writes: [] }))),
  });

  const mode = screen.getByRole("combobox", { name: "ev.mode" });

  await expect.element(mode.getByRole("option", { name: "minpv" })).toHaveValue("2");
  expect(mode.getByRole("option", { name: "2" }).elements()).toHaveLength(0);
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

  await userEvent.fill(screen.getByRole("spinbutton", { name: CHARGE }), "50");
  await userEvent.click(screen.getByRole("button", { name: `${CHARGE} schreiben` }));

  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent(
      "Teilweise geschrieben: Der Zustand des Geräts ist ungewiss. Fehlgeschlagen bei Schritt 2.",
    );
  expect(transport.writes).toEqual([`PUT /api/v1/devices/3/settings/${CHARGE} {"value":50}`]);
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

  await userEvent.selectOptions(screen.getByRole("combobox", { name: "work_mode" }), "2");
  await userEvent.click(screen.getByRole("button", { name: "work_mode schreiben" }));

  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent(
      "Diese Einstellung wurde eben erst geschrieben; warte ihren Mindestabstand ab.",
    );
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

  await expect.element(screen.getByRole("spinbutton", { name: CHARGE })).toBeVisible();
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
  await expect.element(screen.getByRole("button", { name: `${CHARGE} schreiben` })).toBeDisabled();
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
  await expect.element(screen.getByRole("button", { name: `${CHARGE} schreiben` })).toBeDisabled();

  await userEvent.click(screen.getByRole("button", { name: `${CHARGE} freigeben` }));

  expect(transport.writes).toEqual([`PUT /api/v1/devices/3/settings/${CHARGE}/enabled `]);
  await expect.element(screen.getByRole("button", { name: `${CHARGE} schreiben` })).toBeEnabled();
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
