import { afterEach, expect, test, vi } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect, type Transport } from "../api/core.ts";
import { haptics } from "../haptics.ts";
import { feed } from "../live/stream.harness.ts";
import TopologyStep from "./TopologyStep.svelte";
import { closed } from "../motion/animations.harness.ts";

const INVERTER = { id: 1, name: "Wechselrichter", profile: "p", connection: 1, unit: 1 };

/** A Deye SUN-15K-SG05LP3 with its own grid CT, nothing on its GEN port. */
const DEYE = {
  "grid.power": 300,
  "pv.power": 2000,
  "generator.power": 0,
  "generator.energy.total": 0,
  "battery.power": 1200,
  "battery.soc": 55,
  "load.power": 1000,
};

/** A core that keeps each topology change. */
function testCore(): Transport & { readonly changes: unknown[] } {
  const changes: unknown[] = [];

  return {
    base: "http://core.test/",
    changes,
    fetch: async (request) => {
      changes.push(JSON.parse(await request.text()));

      return Response.json({ appliesFrom: "2026-11-09T00:00:00Z", points: [] });
    },
  };
}

async function step() {
  // Sheets and figures land at once.
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });

  // The stream reads the inverter above.
  feed()({ devices: { "1": DEYE } });

  const transport = testCore();
  const done = vi.fn<() => void>();

  const screen = await render(TopologyStep, {
    core: connect(transport),
    devices: [INVERTER],
    ondone: done,
  });

  return { screen, transport, done };
}

// The emulation outlives the file: later files would run under reduced motion.
afterEach(async () => {
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

const grid = { device: 1, role: "grid.power" };

test("a correct proposal is accepted with one tap", async () => {
  const success = vi.spyOn(haptics, "success");
  const { screen, transport, done } = await step();

  await screen.getByRole("button", { name: "Passt so" }).click();

  await expect.poll(() => done.mock.calls.length).toBe(1);
  expect(success).toHaveBeenCalledOnce();
  success.mockRestore();
  expect(transport.changes).toMatchObject([
    {
      points: [
        { name: "Netz", parent: null, claims: [grid] },
        { name: "PV", parent: 0, claims: [{ device: 1, role: "pv.power" }] },
        { name: "Batterie", parent: 0, claims: [{ device: 1, role: "battery.power" }] },
        { name: "Haus", parent: 0, claims: [{ device: 1, role: "load.power" }] },
      ],
    },
  ]);
});

test("each point shows its live power and the root its unmeasured remainder", async () => {
  const { screen } = await step();

  const row = (name: string) => screen.getByRole("listitem", { name, exact: true });

  await expect.element(row("Netz").getByText("300", { exact: true }).first()).toBeVisible();
  await expect.element(row("PV").getByText("2,0", { exact: true })).toBeVisible();
  await expect.element(row("Batterie").getByText("1,2", { exact: true })).toBeVisible();
  await expect.element(row("Haus").getByText("1,0", { exact: true })).toBeVisible();
  // 300 bought + 2000 PV − 1200 charging − 1000 house.
  await expect.element(row("Nicht gemessen").getByText("100", { exact: true })).toBeVisible();
  expect(screen.getByRole("listitem", { name: "Generator" }).query()).toBeNull();
});

test("a point moves under another through a sheet, not a dropdown per row", async () => {
  const { screen, transport, done } = await step();

  await screen.getByRole("button", { name: "Anpassen" }).click();
  expect(screen.getByRole("combobox").query()).toBeNull();

  await screen.getByRole("button", { name: "Batterie bearbeiten" }).click();
  await userEvent.fill(screen.getByLabelText("Name"), "Speicher");
  await screen.getByRole("radio", { name: "Haus" }).click();
  await screen.getByRole("button", { name: "Fertig" }).click();
  await closed(page.getByRole("dialog"));
  await screen.getByRole("button", { name: "Passt so" }).click();

  await expect.poll(() => done.mock.calls.length).toBe(1);
  expect(transport.changes).toMatchObject([
    {
      points: [
        { name: "Netz", parent: null },
        { name: "PV", parent: 0 },
        { name: "Haus", parent: 0 },
        { name: "Speicher", parent: 2 },
      ],
    },
  ]);
});

test("a point left out of the proposal is added back, and a point is removed", async () => {
  const { screen, transport, done } = await step();

  await screen.getByRole("button", { name: "Anpassen" }).click();
  await screen.getByRole("button", { name: "Messpunkt hinzufügen" }).click();
  await screen.getByRole("button", { name: "Generator" }).click();
  await closed(page.getByRole("dialog"));
  await screen.getByRole("button", { name: "PV bearbeiten" }).click();
  await screen.getByRole("button", { name: "Entfernen" }).click();
  await closed(page.getByRole("dialog"));
  await screen.getByRole("button", { name: "Passt so" }).click();

  await expect.poll(() => done.mock.calls.length).toBe(1);
  expect(transport.changes).toMatchObject([
    {
      points: [
        { name: "Netz" },
        { name: "Batterie" },
        { name: "Haus" },
        { name: "Generator", parent: 0, claims: [{ device: 1, role: "generator.power" }] },
      ],
    },
  ]);
});
