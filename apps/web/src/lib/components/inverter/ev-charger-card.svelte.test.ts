import { readable } from "svelte/store";
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { EvccState } from "@SunReye/contracts/evcc";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.hoisted(() => vi.fn());
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));
const postEvccCommand = vi.hoisted(() => vi.fn());
vi.mock("$lib/engine-only", () => ({ postEvccCommand }));
vi.mock("$lib/session", () => ({
  useAppSession: () => readable({ data: { user: { admin: true } }, isPending: false }),
}));

const { coreCapabilities } = await import("$lib/capabilities.svelte");
const { evcc } = await import("$lib/evcc/store.svelte");
const { default: EvChargerCard } = await import("./ev-charger-card.svelte");

const loadpoint = {
  index: 1,
  title: "Carport",
  mode: "pv",
  chargePower: 0,
  chargePowerLive: 0,
  chargePowerSource: "measured",
  charging: false,
  connected: true,
  vehicleSoc: null,
  vehicleTitle: null,
  sessionEnergy: 1500,
  limitSoc: null,
  effectiveLimitSoc: null,
};

function publish() {
  evcc.state = { reachable: true, loadpoints: [loadpoint] } as unknown as EvccState;
  vi.spyOn(evcc, "lease").mockReturnValue(() => {});
}

afterEach(() => {
  get.mockReset();
  postEvccCommand.mockReset();
  evcc.state = null;
  vi.restoreAllMocks();
});

test("an admin opens the quick settings while the core serves EVCC commands", async () => {
  get.mockResolvedValue({ data: { evccCommands: true } });
  await coreCapabilities.load();
  publish();
  render(EvChargerCard);
  await expect.element(page.getByText("Carport")).toBeVisible();
  await expect.element(page.getByRole("button")).toBeVisible();
});

test("the tile stays a read-only card when the core reports EVCC commands absent", async () => {
  get.mockResolvedValue({ data: { evccCommands: false } });
  await coreCapabilities.load();
  publish();
  render(EvChargerCard);
  await expect.element(page.getByText("Carport")).toBeVisible();
  await expect.element(page.getByRole("button")).not.toBeInTheDocument();
});
