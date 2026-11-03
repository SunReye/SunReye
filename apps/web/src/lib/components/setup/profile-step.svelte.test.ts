import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));

const { coreCapabilities } = await import("$lib/capabilities.svelte");
const { default: ProfileStep } = await import("./profile-step.svelte");

const PROFILE = {
  id: "deye-sg05lp3",
  name: "SG05LP3",
  manufacturer: "Deye",
  active: false,
  installed: false,
  builtin: true,
};

const props = {
  profiles: [PROFILE],
  selectedId: null,
  onExternalInstalled: () => {},
  onExternalRemoved: () => {},
};

// The sources manager below the list reads its stored sources when it mounts.
const answer = (data: unknown) => async (path: string) => ({
  data: path === "/api/settings/profile-sources" ? [] : data,
});

afterEach(() => get.mockReset());

test("profile sources are offered while the core serves them", async () => {
  get.mockImplementation(answer({ profileSources: true }));
  await coreCapabilities.load();
  render(ProfileStep, props);
  await expect.element(page.getByRole("button", { name: m.setup_add_source() })).toBeVisible();
});

test("the sources disclosure is gone when the core reports them absent, the profiles stay", async () => {
  get.mockImplementation(answer({ profileSources: false }));
  await coreCapabilities.load();
  render(ProfileStep, props);
  await expect.element(page.getByText(m.setup_select_profile())).toBeVisible();
  await expect.element(page.getByText(m.setup_no_inverter_q())).not.toBeInTheDocument();
  await expect
    .element(page.getByRole("button", { name: m.setup_add_source() }))
    .not.toBeInTheDocument();
});
