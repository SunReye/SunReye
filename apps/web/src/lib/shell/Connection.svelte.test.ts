import { createRawSnippet } from "svelte";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { Live } from "../api/core.ts";
import { stream } from "../live/stream.svelte.ts";
import Shell from "./Shell.svelte";
import "../../app.css";

const children = createRawSnippet(() => ({ render: () => "<p>page</p>" }));

const NOW = Date.parse("2026-11-12T12:00:00Z");

let unfollow = (): void => {};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  await page.viewport(1280, 800);
});

afterEach(() => {
  unfollow();
  vi.useRealTimers();
  localStorage.clear();
});

/** Feeds the shell's stream one frame. */
function streamed(live: Live): void {
  unfollow = stream.follow({
    live: (listener) => {
      listener(live);

      return () => {};
    },
  });
}

const FRESH: Live = { devices: { "1": { "pv.power": 1 } } };

test("the rail's chip says the stream is live and how fresh, quietly", async () => {
  vi.setSystemTime(NOW - 2000);
  streamed(FRESH);
  vi.setSystemTime(NOW);

  const screen = await render(Shell, { shell: "rail", current: "/", admin: false, children });
  const rail = screen.getByRole("navigation", { name: "Hauptnavigation" });

  await expect.element(rail.getByRole("status", { name: "Live · vor 2 s" })).toBeInTheDocument();
});

test("a stalled stream shows on the chip and above any screen but the dashboard", async () => {
  streamed({ devices: FRESH.devices, stale: { "1": { "pv.power": NOW - 40_000 } } });

  const screen = await render(Shell, {
    shell: "rail",
    current: "/history",
    admin: false,
    children,
  });

  const rail = screen.getByRole("navigation", { name: "Hauptnavigation" });

  await expect
    .element(rail.getByRole("status", { name: "Keine Daten seit 40 s" }))
    .toBeInTheDocument();
  await expect
    .element(screen.getByRole("status").filter({ hasText: "Keine Daten seit 40 s" }))
    .toBeVisible();

  await screen.rerender({ current: "/" });

  await expect
    .element(screen.getByRole("status").filter({ hasText: "Keine Daten seit 40 s" }))
    .not.toBeInTheDocument();
});

test("on the phone a lost stream shows above the screen", async () => {
  await page.viewport(390, 800);
  streamed({ devices: FRESH.devices, lost: NOW - 5000 });

  const screen = await render(Shell, { shell: "bar", current: "/tariff", admin: false, children });

  await expect
    .element(screen.getByRole("status").filter({ hasText: "Verbindung getrennt" }))
    .toBeVisible();
});
