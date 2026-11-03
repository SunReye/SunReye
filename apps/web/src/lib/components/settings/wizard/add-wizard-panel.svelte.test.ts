import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import * as m from "$lib/paraglide/messages";
import type { ConnectionView } from "../devices/device-types";
import type { RegisteredProfile } from "../profile-types";
import type { Catalog } from "./add-wizard";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
vi.mock("$app/navigation", () => ({ goto: vi.fn() }));
const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { GET: get, POST: post, DELETE: del } }));
vi.mock("svelte-sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The panel makes its own roster; this one answers from `listed`, so the test
// sees the panel only through the reads it asks for.
let listed: RegisteredProfile[] = [];
const load = vi.fn();
const loadProfiles = vi.fn();
vi.mock("../devices/device-roster.svelte", () => ({
  deviceRoster: () => {
    let profiles = $state<RegisteredProfile[]>([]);
    loadProfiles.mockImplementation(async () => {
      profiles = listed;
    });
    return {
      devices: [],
      integrations: [],
      connections: [GATEWAY],
      catalog: CATALOG,
      get profiles() {
        return profiles;
      },
      load,
      loadProfiles,
    };
  },
}));

const { coreCapabilities } = await import("$lib/capabilities.svelte");
const { default: AddWizardPanel } = await import("./add-wizard-panel.svelte");

const BASE = "https://example.org/profiles/";
const STORED = { baseUrl: BASE, indexPath: "index.json", profileIds: ["acme-hybrid"] };
const GATEWAY: ConnectionView = {
  id: 1,
  name: "Gateway",
  kind: "modbus",
  params: { host: "10.0.0.5", port: 502, transport: "tcp", timeoutMs: 2000, pollIntervalMs: 1000 },
};
const CATALOG: Catalog = {
  modbus: [
    {
      id: "modbus-device",
      label: "Modbus device",
      via: "profile",
      addable: true,
      multiInstance: true,
      fields: [],
    },
  ],
  mqtt: [],
  internal: [],
};
const BUILTIN: RegisteredProfile = {
  id: "deye-sg05lp3",
  name: "SG05LP3",
  manufacturer: "Deye",
  active: false,
  installed: false,
  builtin: true,
};
const ACME: RegisteredProfile = {
  id: "acme-hybrid",
  name: "Acme Hybrid",
  manufacturer: "Acme",
  active: false,
  installed: true,
  builtin: false,
};

const option = (name: string) => page.getByRole("option", { name });
const next = () => page.getByRole("button", { name: m.wizard_next() });

beforeEach(async () => {
  listed = [BUILTIN];
  get.mockImplementation(async (path: string) =>
    path === "/api/settings/profile-sources"
      ? { data: [STORED] }
      : { data: { profileSources: true } },
  );
  del.mockResolvedValue({ data: {} });
  await coreCapabilities.load();
});
afterEach(() => {
  for (const fn of [get, post, del, load, loadProfiles]) fn.mockReset();
});

/** Walks the wizard to step 3 on the device arm and opens the download browser. */
async function openDownloads() {
  render(AddWizardPanel);
  await page.getByLabelText(m.wizard_step_connection()).selectOptions("1");
  await next().click();
  await page.getByRole("button", { name: "Modbus device" }).click();
  await next().click();
  await page.getByRole("button", { name: m.devices_profile_download_more() }).click();
}

test("opening the wizard reads the roster and the profile list", async () => {
  render(AddWizardPanel);
  await vi.waitFor(() => expect(loadProfiles).toHaveBeenCalledTimes(1));
  expect(load).toHaveBeenCalledTimes(1);
});

test("a source added in step 3 puts its profile in the picker and picks it", async () => {
  post.mockImplementation(async () => {
    listed = [BUILTIN, ACME];
    return { data: { ...STORED, skipped: [] } };
  });
  await openDownloads();
  await page.getByLabelText(m.sources_base_label()).fill("https://example.org/more/");
  await page.getByRole("button", { name: m.action_add() }).click();
  await expect.element(option("Acme Hybrid")).toBeInTheDocument();
  await expect.element(page.getByLabelText(m.devices_field_profile())).toHaveValue("acme-hybrid");
});

test("a source removed in step 3 takes its profiles out of the picker", async () => {
  listed = [BUILTIN, ACME];
  await openDownloads();
  await expect.element(option("Acme Hybrid")).toBeInTheDocument();
  listed = [BUILTIN];
  await page.getByRole("button", { name: m.sources_remove_aria({ url: BASE }) }).click();
  await expect.element(option("Acme Hybrid")).not.toBeInTheDocument();
});
