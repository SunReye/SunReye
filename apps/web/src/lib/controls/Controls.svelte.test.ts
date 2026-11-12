import { beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect, type Transport } from "../api/core.ts";
import { attempt, problem } from "../settings/settings.harness.ts";
import Controls from "./Controls.svelte";

const CHARGE = "battery.max_charge_current";
const LOCK = "battery.discharge_lock";

function capabilities(writes = true, enable = "on") {
  return {
    version: "5.0.0",
    schema: { min: 1, max: 1 },
    capabilities: [],
    transports: [],
    devices: {
      "3": {
        estimated: [],
        series: [],
        writes,
        settings: [
          {
            key: CHARGE,
            name: "Max charge current",
            unit: "A",
            range: { min: 0, max: 190 },
            step: 1,
            enable,
          },
          {
            key: LOCK,
            name: "Discharge lock",
            values: [0, 1],
            labels: [
              { value: 0, text: "Unlocked" },
              { value: 1, text: "Locked" },
            ],
            step: 1,
            enable: "on",
          },
          { key: "work_mode", name: "Work mode", values: [0, 1, 2], step: 1, enable: "on" },
        ],
      },
    },
  };
}

/** A core holding each setting's value: a write stores it unless `refuse` answers instead. */
function testCore(
  options: Readonly<{ writes?: boolean; enable?: string; refuse?: () => Response }> = {},
): Transport & { readonly writes: string[] } {
  const { writes: on = true, enable = "on", refuse } = options;
  const support = capabilities(on, enable);
  const writes: string[] = [];

  const values = new Map([
    [CHARGE, 100],
    [LOCK, 0],
    ["work_mode", 1],
  ]);

  return {
    base: "http://core.test/",
    writes,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;

      if (path === "/api/v1/capabilities") return Response.json(support);

      const key = /^\/api\/v1\/devices\/3\/settings\/(.+)$/u.exec(path)?.[1];

      if (key === undefined) return problem(404, "request.route");

      if (request.method === "GET") return Response.json({ value: values.get(key) ?? null });

      const body = await request.text();

      writes.push(`${request.method} ${path} ${body}`);

      if (refuse) return refuse();

      const value = Number(/"value":(\d+)/u.exec(body)?.[1]);

      values.set(key, value);

      return Response.json(attempt({ requested: value, after: value }));
    },
  };
}

beforeEach(async () => {
  await page.viewport(414, 896);
});

test("the root groups settings by role namespace and summarises each from the device", async () => {
  const screen = await render(Controls, {
    core: connect(testCore()),
    open: null,
    onnavigate: () => {},
  });

  await expect.element(screen.getByRole("heading", { name: "Steuerung" })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Batterie 100 A · Unlocked" }))
    .toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Erweitert 1" })).toBeVisible();
  expect(screen.getByRole("button", { name: /Netz/u }).elements()).toHaveLength(0);
});

test("tapping a group asks to open it", async () => {
  const onnavigate = vi.fn();
  const screen = await render(Controls, { core: connect(testCore()), open: null, onnavigate });

  await screen.getByRole("button", { name: /^Batterie/u }).click();

  expect(onnavigate).toHaveBeenCalledWith("battery");
});

test("a group's page shows each setting with its current value and no slider", async () => {
  const screen = await render(Controls, {
    core: connect(testCore()),
    open: "battery",
    onnavigate: () => {},
  });

  await expect
    .element(screen.getByRole("button", { name: "Max charge current 100 A" }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Discharge lock Unlocked" }))
    .toBeVisible();
  expect(document.querySelectorAll("input[type=range]")).toHaveLength(0);
});

test("applying writes through the funnel, closes on confirmed and the row reads the device again", async () => {
  const transport = testCore();

  const screen = await render(Controls, {
    core: connect(transport),
    open: "battery",
    onnavigate: () => {},
  });

  await screen.getByRole("button", { name: "Max charge current 100 A" }).click();
  await expect
    .element(page.getByRole("spinbutton", { name: "Max charge current" }))
    .toHaveAttribute("aria-valuenow", "100");
  page.getByRole("spinbutton", { name: "Max charge current" }).element().focus();
  await userEvent.keyboard("{PageDown}{PageDown}");
  await userEvent.click(page.getByRole("button", { name: /^Übernehmen\s*100 A\s*80 A/u }));

  expect(transport.writes).toEqual([`PUT /api/v1/devices/3/settings/${CHARGE} {"value":80}`]);
  await expect.element(page.getByRole("spinbutton")).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: "Max charge current 80 A" }))
    .toBeVisible();
});

test("a refused apply names its reason beside the write log link and keeps the editor open", async () => {
  const transport = testCore({ refuse: () => problem(429, "setting.interval") });

  const screen = await render(Controls, {
    core: connect(transport),
    open: "advanced",
    onnavigate: () => {},
  });

  await screen.getByRole("button", { name: "Work mode 1" }).click();
  await userEvent.click(page.getByRole("radio", { name: "2" }));
  await userEvent.click(page.getByRole("button", { name: /^Übernehmen/u }));

  const alert = page.getByRole("alert");

  await expect.element(alert.getByText("Abgelehnt.")).toBeVisible();
  await expect.element(alert.getByRole("link", { name: "Schreibprotokoll" })).toBeVisible();
  await expect.element(page.getByRole("radiogroup", { name: "Work mode" })).toBeVisible();
});

test("a mismatch names the failed step", async () => {
  const transport = testCore({
    refuse: () => Response.json(attempt({ outcome: "partial", after: null, failedStep: 2 })),
  });

  const screen = await render(Controls, {
    core: connect(transport),
    open: "advanced",
    onnavigate: () => {},
  });

  await screen.getByRole("button", { name: "Work mode 1" }).click();
  await userEvent.click(page.getByRole("radio", { name: "2" }));
  await userEvent.click(page.getByRole("button", { name: /^Übernehmen/u }));

  const alert = page.getByRole("alert");

  await expect.element(alert.getByText("Abweichung.")).toBeVisible();
  await expect.element(alert.getByText(/Fehlgeschlagen bei Schritt 2\./u)).toBeVisible();
});

test("with writes off every control is read-only under a banner", async () => {
  const screen = await render(Controls, {
    core: connect(testCore({ writes: false })),
    open: "battery",
    onnavigate: () => {},
  });

  await expect.element(screen.getByRole("status").getByText("Nur lesen.")).toBeVisible();
  const row = screen.getByRole("button", { name: "Max charge current 100 A" });

  await expect.element(row).toHaveAttribute("aria-disabled", "true");
  // Playwright will not click an aria-disabled control; a finger can.
  row.element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(page.getByRole("spinbutton").elements()).toHaveLength(0);
});

test("a setting awaiting the admin's enable is read-only and says where to enable it", async () => {
  const screen = await render(Controls, {
    core: connect(testCore({ enable: "off" })),
    open: "battery",
    onnavigate: () => {},
  });

  await expect
    .element(screen.getByText("Braucht deine Freigabe unter Einstellungen › Schreiben"))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: /^Max charge current/u }))
    .toHaveAttribute("aria-disabled", "true");
});

test("from 1024 px the groups and the chosen group's settings sit side by side", async () => {
  await page.viewport(1280, 900);

  const screen = await render(Controls, {
    core: connect(testCore()),
    open: null,
    onnavigate: () => {},
  });

  await expect.element(screen.getByRole("navigation", { name: "Gruppen" })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Max charge current 100 A" }))
    .toBeVisible();
});
