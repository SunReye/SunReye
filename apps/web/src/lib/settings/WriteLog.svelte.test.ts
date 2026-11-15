// The write log (ADR 7) as Settings › Logs shows it: entries on a phone, a table with room.
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect, type Transport } from "../api/core.ts";
import SettingsScreen from "./SettingsScreen.svelte";
import { attempt, testCore } from "./settings.harness.ts";

afterEach(async () => {
  await page.viewport(414, 896);
});

/** Settings opened on its logs, as the admin. */
function opened(transport: Transport, group: string) {
  return render(SettingsScreen, {
    core: connect(transport),
    admin: true,
    open: group,
    onnavigate: () => null,
    level: null,
    onlevel: () => null,
  });
}

test("on a phone the write log is a list of entries, newest first", async () => {
  const log = {
    writes: [
      attempt({ outcome: "verified" }),
      attempt({ outcome: "mismatch", after: 108, time: "2026-11-09T09:00:00Z" }),
    ],
  };

  const screen = await opened(
    testCore(() => Response.json(log)),
    "logs",
  );

  const list = screen.getByRole("list", { name: "Schreibprotokoll" });
  const first = list.getByRole("listitem").first();

  await expect.element(list).toBeVisible();

  const text = first.element().textContent ?? "";

  expect(text).toMatch(/^\s*Max\. Ladestrom\s+Wechselrichter/u);
  expect(text).toMatch(/Abweichend.*Zurückgelesen 108\s+108 → 50/u);
  expect(screen.getByRole("table").query()).toBeNull();
});

test("with room the write log is a table", async () => {
  await page.viewport(1280, 800);
  const log = { writes: [attempt({ outcome: "mismatch", after: 108 })] };

  const screen = await opened(
    testCore(() => Response.json(log)),
    "logs",
  );

  const table = screen.getByRole("table", { name: "Schreibprotokoll" });

  await expect.element(table).toBeVisible();
  await expect.element(table.getByRole("cell", { name: "Max. Ladestrom" })).toBeVisible();
  await expect.element(table.getByRole("cell", { name: /^Abweichend/u })).toBeVisible();
});

test("an empty write log says what will land there", async () => {
  const screen = await opened(
    testCore(() => Response.json({ writes: [] })),
    "logs",
  );

  await expect.element(screen.getByText("Noch nichts geschrieben")).toBeVisible();
});
