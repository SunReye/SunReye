import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import * as m from "$lib/paraglide/messages";
import type { AddDeviceForm } from "./device-types";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.fn();
const del = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { GET: get, DELETE: del } }));

const { coreCapabilities } = await import("$lib/capabilities.svelte");
const { default: ProfileField } = await import("./profile-field.svelte");

const PROFILE = {
  id: "deye-sg05lp3",
  name: "SG05LP3",
  manufacturer: "Deye",
  active: false,
  installed: true,
  builtin: true,
};
const props = {
  form: { profileId: "" } as AddDeviceForm,
  registered: [PROFILE],
  refusal: null,
  onInstalled: () => {},
  onRemoved: () => {},
};

const answer = (data: unknown) => async (path: string) => ({
  data: path === "/api/settings/profile-sources" ? [] : data,
});
const download = () => page.getByRole("button", { name: m.devices_profile_download_more() });

afterEach(() => {
  get.mockReset();
  del.mockReset();
});

test("the download browser opens onto the sources manager while the core serves profile sources", async () => {
  get.mockImplementation(answer({ profileSources: true }));
  await coreCapabilities.load();
  render(ProfileField, props);
  await download().click();
  await expect.element(page.getByText(m.sources_title())).toBeVisible();
});

test("the download browser is gone when the core reports profile sources absent, the select stays", async () => {
  get.mockImplementation(answer({ profileSources: false }));
  await coreCapabilities.load();
  render(ProfileField, props);
  await expect.element(page.getByLabelText(m.devices_field_profile())).toBeVisible();
  await expect.element(download()).not.toBeInTheDocument();
});

test("a source removed in the download browser is reported, for the wizard's step and the dialog alike", async () => {
  const url = "https://example.org/profiles/";
  get.mockImplementation(async (path: string) =>
    path === "/api/settings/profile-sources"
      ? { data: [{ baseUrl: url, indexPath: "index.json", profileIds: ["acme-hybrid"] }] }
      : { data: { profileSources: true } },
  );
  del.mockResolvedValue({ data: {} });
  await coreCapabilities.load();
  const onRemoved = vi.fn();
  render(ProfileField, { ...props, onRemoved });
  await download().click();
  await page.getByRole("button", { name: m.sources_remove_aria({ url }) }).click();
  await vi.waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
});
