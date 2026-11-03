import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { GET: get, POST: post, DELETE: del } }));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("svelte-sonner", () => ({ toast }));

const { default: ExternalProfilesManager } = await import("./external-profiles-manager.svelte");

const BASE = "https://example.org/profiles/";
const STORED = { baseUrl: BASE, indexPath: "index.json", profileIds: ["acme-hybrid", "acme-mini"] };
let listed: unknown[] = [];

beforeEach(() => {
  listed = [];
  get.mockImplementation(async () => ({ data: listed }));
});
afterEach(() => {
  for (const fn of [get, post, del, toast.success, toast.error]) fn.mockReset();
});

async function addSource(url = BASE) {
  await page.getByLabelText(m.sources_base_label()).fill(url);
  await page.getByRole("button", { name: m.action_add() }).click();
}

test("shows the sources the core stores", async () => {
  listed = [STORED];
  render(ExternalProfilesManager, {});
  await expect.element(page.getByText(BASE)).toBeVisible();
  expect(get).toHaveBeenCalledWith("/api/settings/profile-sources");
});

test("offers the single-file import beside the sources", async () => {
  render(ExternalProfilesManager, {});
  await expect.element(page.getByLabelText(m.profile_import_label())).toBeVisible();
});

test("an added source is posted, listed again, and its first profile reported", async () => {
  post.mockImplementation(async () => {
    listed = [STORED];
    return { data: { ...STORED, skipped: [] } };
  });
  const onInstalled = vi.fn();
  render(ExternalProfilesManager, { onInstalled });
  await addSource();
  await expect
    .element(page.getByText(`index.json · ${m.sources_profile_count({ count: 2 })}`))
    .toBeVisible();
  expect(post).toHaveBeenCalledWith("/api/settings/profile-sources", {
    body: { baseUrl: BASE, indexPath: "index.json" },
  });
  expect(onInstalled).toHaveBeenCalledExactlyOnceWith("acme-hybrid");
  expect(toast.success).toHaveBeenCalledWith(m.sources_added({ count: 2 }));
});

test("a file the index listed that did not load is named with its reason", async () => {
  post.mockResolvedValue({
    data: {
      ...STORED,
      profileIds: ["acme-hybrid"],
      skipped: [{ path: "profiles/bad.json", reason: "metrics[1].scale: invalid type" }],
    },
  });
  render(ExternalProfilesManager, {});
  await addSource();
  await expect
    .element(
      page.getByText(
        m.sources_skipped_item({
          path: "profiles/bad.json",
          reason: "metrics[1].scale: invalid type",
        }),
      ),
    )
    .toBeVisible();
});

test("a source whose files were all skipped reports nothing as installed", async () => {
  post.mockResolvedValue({
    data: { ...STORED, profileIds: [], skipped: [{ path: "a.json", reason: "name: missing" }] },
  });
  const onInstalled = vi.fn();
  render(ExternalProfilesManager, { onInstalled });
  await addSource();
  await expect
    .element(page.getByText(m.sources_skipped_item({ path: "a.json", reason: "name: missing" })))
    .toBeVisible();
  expect(onInstalled).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
});

test("a refused source shows the core's reason and lists nothing", async () => {
  post.mockResolvedValue({ error: { error: "cannot fetch the index: status 404" } });
  const onInstalled = vi.fn();
  render(ExternalProfilesManager, { onInstalled });
  await addSource();
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent(m.sources_add_failed({ error: "cannot fetch the index: status 404" }));
  expect(onInstalled).not.toHaveBeenCalled();
  await expect.element(page.getByText(m.sources_none())).toBeVisible();
});

test("an unreachable core reads as a failed request", async () => {
  post.mockRejectedValue(new TypeError("fetch failed"));
  render(ExternalProfilesManager, {});
  await addSource();
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent(m.sources_add_failed({ error: m.conn_request_failed() }));
});

test("a later add clears the earlier skipped list and failure", async () => {
  post.mockResolvedValueOnce({ error: { error: "cannot fetch the index: status 404" } });
  post.mockResolvedValueOnce({ data: { ...STORED, skipped: [] } });
  render(ExternalProfilesManager, {});
  await addSource();
  await expect.element(page.getByRole("alert")).toBeVisible();
  await addSource("https://example.org/other/");
  await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
});

test("a refused add drops the skipped files an earlier add listed", async () => {
  const skipped = { path: "profiles/bad.json", reason: "name: missing" };
  post.mockResolvedValueOnce({ data: { ...STORED, profileIds: [], skipped: [skipped] } });
  post.mockResolvedValueOnce({ error: { error: "cannot fetch the index: status 404" } });
  render(ExternalProfilesManager, {});
  await addSource();
  await expect.element(page.getByText(m.sources_skipped_title())).toBeVisible();
  await addSource("https://example.org/other/");
  await expect.element(page.getByRole("alert")).toBeVisible();
  await expect.element(page.getByText(m.sources_skipped_title())).not.toBeInTheDocument();
});

test("an imported file is reported like a fetched profile", async () => {
  post.mockResolvedValue({ data: { id: "acme-hybrid" } });
  const onInstalled = vi.fn();
  render(ExternalProfilesManager, { onInstalled });
  await page
    .getByLabelText(m.profile_import_label())
    .upload(new File(['{"id":"acme-hybrid"}'], "acme.json", { type: "application/json" }));
  await vi.waitFor(() => expect(onInstalled).toHaveBeenCalledWith("acme-hybrid"));
});

const removeButton = () => page.getByRole("button", { name: m.sources_remove_aria({ url: BASE }) });

test("a removed source is deleted by its URL and index path, then gone from the list", async () => {
  listed = [STORED];
  del.mockImplementation(async () => {
    listed = [];
    return { response: { status: 204 } };
  });
  const onRemoved = vi.fn();
  render(ExternalProfilesManager, { onRemoved });
  await removeButton().click();
  await expect.element(page.getByText(m.sources_none())).toBeVisible();
  expect(del).toHaveBeenCalledWith("/api/settings/profile-sources", {
    params: { query: { baseUrl: BASE, indexPath: "index.json" } },
  });
  expect(onRemoved).toHaveBeenCalledOnce();
  expect(toast.success).toHaveBeenCalledWith(m.sources_removed());
});

test("a refused removal shows the core's reason and keeps the source", async () => {
  listed = [STORED];
  del.mockResolvedValue({ error: { error: "the source supplies the active profile" } });
  const onRemoved = vi.fn();
  render(ExternalProfilesManager, { onRemoved });
  await removeButton().click();
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent(
      m.sources_remove_failed({ error: "the source supplies the active profile" }),
    );
  await expect.element(page.getByText(BASE)).toBeVisible();
  expect(onRemoved).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
});

test("an unreachable core reads as a failed removal", async () => {
  listed = [STORED];
  del.mockRejectedValue(new TypeError("fetch failed"));
  render(ExternalProfilesManager, {});
  await removeButton().click();
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent(m.sources_remove_failed({ error: m.conn_request_failed() }));
});
