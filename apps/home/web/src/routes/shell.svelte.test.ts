import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import App from "./shell.harness.svelte";
import { keepOffline } from "./route.harness.ts";
import { json } from "../lib/api/core.harness.ts";

const pass = globalThis.fetch.bind(globalThis);

const INVERTER = { id: 1, name: "Wechselrichter", profile: "deye-sg05lp3", connection: 1, unit: 1 };

/** What the core serves: signed in when `session` is undefined; a viewer is refused the devices. */
interface Served {
  session: "auth.required" | undefined;
  admin: boolean;
}

const served: Served = { session: undefined, admin: true };

function problem(status: number, code: string): Response {
  return Response.json(
    { status, code },
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

function answer(pathname: string): Response | undefined {
  switch (pathname) {
    case "/api/v1/session":
      return served.session === undefined
        ? new Response(null, { status: 204 })
        : problem(401, served.session);
    case "/api/v1/login":
      served.session = undefined;

      return new Response(null, { status: 204 });
    case "/api/v1/devices":
      if (served.session !== undefined) return problem(401, served.session);

      return served.admin
        ? json("DeviceList", { devices: [INVERTER] })
        : problem(403, "auth.forbidden");
    case "/api/v1/live":
      return new Response(new ReadableStream(), {
        headers: { "content-type": "text/event-stream" },
      });
    default:
      return pathname.startsWith("/api/") ? problem(404, "request.route") : undefined;
  }
}

keepOffline();

beforeEach(async () => {
  served.session = undefined;
  served.admin = true;
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- fetch's own parameters are mutable.
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);

    return Promise.resolve(answer(url.pathname) ?? pass(input, init));
  });
  await page.viewport(1280, 900);
});

// The fake core stays in place after the file's last test: that page stays mounted, and its
// fetches still in flight would otherwise reach the test server. Each file runs in its own frame.

test("the admin's rail lists Controls", async () => {
  const screen = await render(App);

  await expect
    .element(screen.getByRole("link", { name: /Steuerung/u }))
    .toHaveAttribute("href", "#/controls");
});

test("a viewer's rail lists no Controls", async () => {
  served.admin = false;

  const screen = await render(App);

  await expect.element(screen.getByRole("link", { name: "Verlauf" })).toBeInTheDocument();
  await expect.element(screen.getByRole("group", { name: "Heute" })).toBeVisible();
  expect(screen.getByRole("link", { name: /Steuerung/u }).query()).toBeNull();
});

test("sign-in shows no rail, and the admin signed in gets Controls", async () => {
  served.session = "auth.required";

  const screen = await render(App);

  await expect.element(screen.getByRole("button", { name: "Anmelden" })).toBeVisible();
  expect(screen.getByRole("navigation", { name: "Hauptnavigation" }).query()).toBeNull();

  await userEvent.fill(screen.getByLabelText("Passwort"), "solar sun");
  await screen.getByRole("button", { name: "Anmelden" }).click();

  await expect.element(screen.getByRole("link", { name: /Steuerung/u })).toBeInTheDocument();
});

test("the phone's bar stays in place while the dashboard opens from another screen", async () => {
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true });
  onTestFinished(async () => {
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
  });
  await page.viewport(400, 800);

  const screen = await render(App, { away: true });
  const nav = screen.getByRole("navigation", { name: "Hauptnavigation" });

  await expect.element(nav.getByRole("radio", { name: "Mehr" })).toBeVisible();

  const bar = nav.element();
  let removed = 0;

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's own records.
  const watch = new MutationObserver((records) => {
    for (const record of records) if ([...record.removedNodes].includes(bar)) removed += 1;
  });

  watch.observe(document.body, { childList: true, subtree: true });
  onTestFinished(() => {
    watch.disconnect();
  });

  await screen.rerender({ away: false });
  await expect.element(screen.getByRole("group", { name: "Heute" })).toBeVisible();

  expect(removed).toBe(0);
  expect(bar.isConnected).toBe(true);
});
