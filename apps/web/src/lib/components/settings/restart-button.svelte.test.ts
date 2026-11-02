import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
vi.mock("$lib/engine-admin", () => ({ restartServer: vi.fn() }));
const get = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));

const { coreCapabilities } = await import("$lib/capabilities.svelte");
const { default: RestartButton } = await import("./restart-button.svelte");

const button = () => page.getByRole("button", { name: m.settings_restart_server() });

afterEach(() => get.mockReset());

test("the button is offered while the core serves a restart", async () => {
  get.mockResolvedValue({ data: { restart: true } });
  await coreCapabilities.load();
  render(RestartButton);
  await expect.element(button()).toBeVisible();
});

test("no button when the core reports restart absent", async () => {
  get.mockResolvedValue({ data: { restart: false } });
  await coreCapabilities.load();
  render(RestartButton);
  await expect.element(button()).not.toBeInTheDocument();
});
