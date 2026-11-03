import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import * as m from "$lib/paraglide/messages";
import type { RegisteredProfile } from "../profile-types";
import type { DeviceRoster } from "./device-roster";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { GET: get, POST: post, DELETE: del } }));
vi.mock("svelte-sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { coreCapabilities } = await import("$lib/capabilities.svelte");
const { default: AddDeviceDialog } = await import("./add-device-dialog.svelte");

const BASE = "https://example.org/profiles/";
const STORED = { baseUrl: BASE, indexPath: "index.json", profileIds: ["acme-hybrid"] };
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

/** What the core lists right now: the dialog only sees it through `loadProfiles`. */
let listed: RegisteredProfile[] = [];
const loadProfiles = vi.fn();

/** A roster whose profile list is `$state`, re-read from `listed` by each `loadProfiles`. */
function stubRoster(): DeviceRoster {
  let profiles = $state<RegisteredProfile[]>([]);
  loadProfiles.mockImplementation(async () => {
    profiles = listed;
  });
  return {
    devices: [],
    connections: [],
    get profiles() {
      return profiles;
    },
    loadProfiles,
  } as unknown as DeviceRoster;
}

const option = (name: string) => page.getByRole("option", { name });

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
  for (const fn of [get, post, del, loadProfiles]) fn.mockReset();
});

async function openDownloads() {
  render(AddDeviceDialog, { open: true, roster: stubRoster() });
  await page.getByRole("button", { name: m.devices_profile_download_more() }).click();
}

test("opening the dialog reads the profile list", async () => {
  render(AddDeviceDialog, { open: true, roster: stubRoster() });
  await expect.element(option("SG05LP3 · " + m.badge_builtin())).toBeInTheDocument();
  expect(loadProfiles).toHaveBeenCalledTimes(1);
});

test("a source added from the dialog puts its profile in the select and picks it", async () => {
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

test("a source removed from the dialog takes its profiles out of the select", async () => {
  listed = [BUILTIN, ACME];
  await openDownloads();
  await expect.element(option("Acme Hybrid")).toBeInTheDocument();
  listed = [BUILTIN];
  await page.getByRole("button", { name: m.sources_remove_aria({ url: BASE }) }).click();
  await expect.element(option("Acme Hybrid")).not.toBeInTheDocument();
  expect(loadProfiles).toHaveBeenCalledTimes(2);
});
