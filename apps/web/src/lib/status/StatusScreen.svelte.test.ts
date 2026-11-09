import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import StatusScreen from "./StatusScreen.svelte";

const BROKER = {
  id: 2,
  name: "hass",
  transport: "mqtt",
  host: "hass.lan",
  port: 1883,
  secrets: [],
  status: { connected: false, lastError: "connection refused" },
};

const GATEWAY = {
  id: 1,
  name: "gateway",
  transport: "modbus-tcp",
  host: "192.168.1.20",
  port: 502,
  secrets: [],
};

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
      return Response.json({ problems: [{ code: "clock.unsynced" }] });

    if (path === "/api/v1/connections") return Response.json({ connections: [GATEWAY, BROKER] });

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
    Response.json({ lines: logged });

test("the screen shows the core's problems, each broker's state and its log, oldest first", async () => {
  const core = connect(testCore([lines("INFO serving", "WARN unreachable device=1")]));

  const screen = await render(StatusScreen, { core });

  await expect.element(screen.getByRole("listitem").filter({ hasText: "Uhr" })).toBeInTheDocument();
  await expect
    .element(screen.getByRole("listitem").filter({ hasText: "hass" }))
    .toHaveTextContent("hass: getrennt, connection refused");
  await expect.element(screen.getByText("gateway")).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("log"))
    .toHaveTextContent("INFO serving WARN unreachable device=1");
});

test("refreshing reads the log again", async () => {
  const core = connect(testCore([lines("INFO serving"), lines("INFO serving", "INFO stopped")]));
  const screen = await render(StatusScreen, { core });
  await expect.element(screen.getByRole("log")).toHaveTextContent("INFO serving");

  await userEvent.click(screen.getByRole("button", { name: "Aktualisieren" }));

  await expect.element(screen.getByRole("log")).toHaveTextContent("INFO serving INFO stopped");
});

test("without the admin's session the log is refused with its reason", async () => {
  const core = connect(testCore([() => problem(403, "auth.forbidden")]));

  const screen = await render(StatusScreen, { core });

  await expect.element(screen.getByRole("alert")).toHaveTextContent("Das darf nur der Admin.");
  await expect.element(screen.getByRole("log")).not.toBeInTheDocument();
});
