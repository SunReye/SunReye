import { expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));

const { default: ProfileSourcesEditor } = await import("./profile-sources-editor.svelte");

const OFFICIAL = {
  baseUrl: "https://raw.githubusercontent.com/SunReye/profiles/main/",
  indexPath: "index.json",
  profileIds: ["deye-sg05lp3", "sungrow-sh10rt"],
};
const props = { sources: [], busy: false, onAdd: () => {}, onRemove: () => {} };

const base = () => page.getByLabelText(m.sources_base_label());
const index = () => page.getByLabelText(m.sources_index_label());
const add = () => page.getByRole("button", { name: m.action_add() });

test("lists each source with its index path and how many profiles it supplied", async () => {
  render(ProfileSourcesEditor, { ...props, sources: [OFFICIAL] });
  await expect.element(page.getByText(OFFICIAL.baseUrl)).toBeVisible();
  await expect
    .element(page.getByText(`index.json · ${m.sources_profile_count({ count: 2 })}`))
    .toBeVisible();
});

test("an empty list says so", async () => {
  render(ProfileSourcesEditor, props);
  await expect.element(page.getByText(m.sources_none())).toBeVisible();
});

test("the index path starts as index.json", async () => {
  render(ProfileSourcesEditor, props);
  await expect.element(index()).toHaveValue("index.json");
});

test("add hands over the trimmed base URL and index path, then empties the base", async () => {
  const onAdd = vi.fn();
  render(ProfileSourcesEditor, { ...props, onAdd });
  await base().fill("  https://example.org/profiles  ");
  await index().fill(" listing/index.json ");
  await add().click();
  expect(onAdd).toHaveBeenCalledExactlyOnceWith({
    baseUrl: "https://example.org/profiles",
    indexPath: "listing/index.json",
  });
  await expect.element(base()).toHaveValue("");
});

test("Enter in the base URL field adds", async () => {
  const onAdd = vi.fn();
  render(ProfileSourcesEditor, { ...props, onAdd });
  await base().fill("https://example.org/p/");
  await base().click();
  await userEvent.keyboard("{Enter}");
  expect(onAdd).toHaveBeenCalledOnce();
});

test("a base URL that is not https is named and not sent", async () => {
  const onAdd = vi.fn();
  render(ProfileSourcesEditor, { ...props, onAdd });
  await base().fill("http://example.org/p/");
  await add().click();
  await expect.element(page.getByRole("alert")).toHaveTextContent(m.sources_url_invalid());
  expect(onAdd).not.toHaveBeenCalled();
});

test("a blank base URL or index path is not sent", async () => {
  const onAdd = vi.fn();
  render(ProfileSourcesEditor, { ...props, onAdd });
  await add().click();
  await base().fill("https://example.org/p/");
  await index().fill("   ");
  await add().click();
  expect(onAdd).not.toHaveBeenCalled();
});

test("a source already listed is refused", async () => {
  const onAdd = vi.fn();
  render(ProfileSourcesEditor, { ...props, sources: [OFFICIAL], onAdd });
  await base().fill(OFFICIAL.baseUrl);
  await add().click();
  await expect.element(page.getByRole("alert")).toHaveTextContent(m.sources_already_added());
  expect(onAdd).not.toHaveBeenCalled();
});

test("a later edit clears the earlier refusal", async () => {
  render(ProfileSourcesEditor, props);
  await base().fill("http://example.org/");
  await add().click();
  await expect.element(page.getByRole("alert")).toBeVisible();
  await base().fill("https://example.org/");
  await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
});

test("the form is disabled while a source is being fetched", async () => {
  render(ProfileSourcesEditor, { ...props, busy: true });
  await expect.element(base()).toBeDisabled();
  await expect.element(index()).toBeDisabled();
  await expect.element(add()).toBeDisabled();
});

test("a long source URL wraps inside a phone and the controls stay tappable", async () => {
  await page.viewport(390, 844);
  const long = `https://raw.githubusercontent.com/${"a".repeat(80)}/main/`;
  render(ProfileSourcesEditor, { ...props, sources: [{ ...OFFICIAL, baseUrl: long }] });
  const url = (await page.getByText(long).element()).getBoundingClientRect();
  expect(url.right).toBeLessThanOrEqual(390);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  const button = (await add().element()).getBoundingClientRect();
  expect(button.height).toBeGreaterThanOrEqual(36);
  expect(button.right).toBeLessThanOrEqual(390);
});

test("a source's remove button hands that source over", async () => {
  const onRemove = vi.fn();
  render(ProfileSourcesEditor, { ...props, sources: [OFFICIAL], onRemove });
  await page
    .getByRole("button", { name: m.sources_remove_aria({ url: OFFICIAL.baseUrl }) })
    .click();
  expect(onRemove).toHaveBeenCalledExactlyOnceWith({
    baseUrl: OFFICIAL.baseUrl,
    indexPath: OFFICIAL.indexPath,
  });
});

test("remove is off while a request is in flight", async () => {
  render(ProfileSourcesEditor, { ...props, sources: [OFFICIAL], busy: true });
  await expect
    .element(page.getByRole("button", { name: m.sources_remove_aria({ url: OFFICIAL.baseUrl }) }))
    .toBeDisabled();
});
