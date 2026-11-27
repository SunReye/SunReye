import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import type { Connection } from "../api/setup.ts";
import StatusScreen from "./StatusScreen.svelte";
import { json } from "../api/core.harness.ts";

const BROKER = {
  id: 2,
  name: "hass",
  transport: "mqtt",
  host: "hass.lan",
  port: 1883,
  secrets: [],
  status: { connected: false, lastError: "connection refused" },
} satisfies Connection;

const GATEWAY = {
  id: 1,
  name: "gateway",
  transport: "modbus-tcp",
  host: "192.168.1.20",
  port: 502,
  secrets: [],
} satisfies Connection;

function problem(status: number, code: string): Response {
  return Response.json(
    { status, code },
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

/** A test core with one problem and two connections; the log reads from `logs` in turn. */
function testCore(logs: readonly (() => Response)[]): Transport {
  let read = 0;

  function log(): Response {
    const next = logs[Math.min(read, logs.length - 1)];

    read += 1;

    return next?.() ?? new Response(null, { status: 500 });
  }

  function answer(path: string): Response {
    if (path === "/api/v1/problems")
      return json("Problems", { problems: [{ code: "clock.unsynced" }] });

    if (path === "/api/v1/connections")
      return json("Connections", { connections: [GATEWAY, BROKER] });

    return path === "/api/v1/logs" ? log() : new Response(null, { status: 404 });
  }

  return {
    base: "http://core.test/",
    fetch: (request) => Promise.resolve(answer(new URL(request.url).pathname)),
  };
}

const lines =
  (...logged: readonly string[]) =>
  () =>
    json("Lines", { lines: logged });

const SERVING = "2026-11-13T09:12:00.000001Z  INFO sunreye_core::api: serving";
const UNREACHABLE = "2026-11-13T09:12:01.000001Z  WARN sunreye_core::poll: unreachable device=1";
const FULL = "2026-11-13T09:12:02.000001Z ERROR sunreye_core::storage: disk full";

/** No `pre`, native select, radio, checkbox or visible file input: every control is a ui component. */
const BROWSER_DEFAULTS = "pre, select, input:not(.sr-only)";

test("each problem is a row in the error treatment", async () => {
  const core = connect(testCore([lines(SERVING)]));

  const screen = await render(StatusScreen, { core });

  const problems = screen.getByRole("region", { name: "Probleme" });
  const row = problems.getByRole("listitem").filter({ hasText: "Uhr" });
  await expect.element(row).toBeInTheDocument();
  await expect.element(row.getByRole("img", { name: "Fehler" })).toBeInTheDocument();
});

test("each broker is a row with its state and last error; other connections are not listed", async () => {
  const core = connect(testCore([lines(SERVING)]));

  const screen = await render(StatusScreen, { core });

  const brokers = screen.getByRole("region", { name: "MQTT-Broker" });
  await expect
    .element(brokers.getByRole("listitem").filter({ hasText: "hass" }))
    .toHaveTextContent("hass Getrennt · connection refused");
  await expect.element(screen.getByText("gateway")).not.toBeInTheDocument();
});

test("the log lists each line newest first with its level, time and message", async () => {
  const core = connect(testCore([lines(SERVING, UNREACHABLE)]));

  const screen = await render(StatusScreen, { core });

  const rows = screen.getByRole("log").getByRole("listitem");
  await expect.element(rows.first().getByText("WARN", { exact: true })).toBeVisible();
  await expect
    .element(rows.first().getByText("sunreye_core::poll: unreachable device=1"))
    .toBeVisible();
  await expect
    .element(rows.first().getByRole("time"))
    .toHaveAttribute("datetime", "2026-11-13T09:12:01.000001Z");
  await expect.element(rows.last().getByText("sunreye_core::api: serving")).toBeVisible();
  expect(screen.container.querySelectorAll(BROWSER_DEFAULTS)).toHaveLength(0);
});

test("a line the core did not format stays whole", async () => {
  const core = connect(testCore([lines("  at the end of the backtrace")]));

  const screen = await render(StatusScreen, { core });

  await expect
    .element(screen.getByRole("log").getByRole("listitem"))
    .toHaveTextContent("at the end of the backtrace");
});

test("the level filter keeps warnings and errors, then errors only", async () => {
  const core = connect(testCore([lines(SERVING, UNREACHABLE, FULL)]));
  const screen = await render(StatusScreen, { core });
  const rows = screen.getByRole("log").getByRole("listitem");
  await expect.element(rows.nth(2)).toBeInTheDocument();

  await screen.getByRole("radio", { name: "Warnungen" }).click();

  await expect.element(rows.nth(1).getByText(/unreachable/u)).toBeVisible();
  await expect.element(rows.nth(2)).not.toBeInTheDocument();

  await screen.getByRole("radio", { name: "Fehler" }).click();

  await expect.element(rows.first().getByText(/disk full/u)).toBeVisible();
  await expect.element(rows.nth(1)).not.toBeInTheDocument();
});

test("a filter that keeps no line says so", async () => {
  const core = connect(testCore([lines(SERVING)]));
  const screen = await render(StatusScreen, { core });
  await expect.element(screen.getByRole("log").getByRole("listitem")).toBeInTheDocument();

  await screen.getByRole("radio", { name: "Fehler" }).click();

  await expect.element(screen.getByText("Keine Zeilen auf dieser Stufe.")).toBeVisible();
});

test("refreshing reads the log again", async () => {
  const core = connect(testCore([lines(SERVING), lines(SERVING, FULL)]));
  const screen = await render(StatusScreen, { core });
  await expect.element(screen.getByRole("log").getByText(/serving/u)).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Aktualisieren" }));

  await expect
    .element(
      screen
        .getByRole("log")
        .getByRole("listitem")
        .first()
        .getByText(/disk full/u),
    )
    .toBeVisible();
});

test("without the admin's session the log is refused with its reason", async () => {
  const core = connect(testCore([() => problem(403, "auth.forbidden")]));

  const screen = await render(StatusScreen, { core });

  await expect.element(screen.getByRole("alert")).toHaveTextContent("Das darf nur der Admin.");
  await expect.element(screen.getByRole("log")).not.toBeInTheDocument();
});
