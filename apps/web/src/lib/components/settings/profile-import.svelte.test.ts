import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const post = vi.fn();
vi.mock("$lib/core-api", () => ({ core: { POST: post } }));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("svelte-sonner", () => ({ toast }));

const { default: ProfileImport } = await import("./profile-import.svelte");

const FILE_TEXT =
  '{"id":"acme-hybrid","name":"Acme","manufacturer":"Acme","version":"1","metrics":[]}';
const file = (text = FILE_TEXT) => new File([text], "acme.json", { type: "application/json" });
const picker = () => page.getByLabelText(m.profile_import_label());

afterEach(() => {
  post.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

test("a picked file is posted as its own text and the new id reported", async () => {
  post.mockResolvedValue({ data: { id: "acme-hybrid" } });
  const onImported = vi.fn();
  render(ProfileImport, { onImported });
  await picker().upload(file());
  await vi.waitFor(() => expect(onImported).toHaveBeenCalledWith("acme-hybrid"));
  const [path, init] = post.mock.calls[0];
  expect(path).toBe("/api/settings/profiles/import");
  expect(init.body).toBe(FILE_TEXT);
  expect(init.bodySerializer(init.body)).toBe(FILE_TEXT);
  expect(toast.success).toHaveBeenCalledWith(m.profile_import_success({ id: "acme-hybrid" }));
});

test("a rejected profile shows the core's message naming the field", async () => {
  post.mockResolvedValue({ error: { error: "metrics[1].scale: invalid type, expected f64" } });
  const onImported = vi.fn();
  render(ProfileImport, { onImported });
  await picker().upload(file('{"id": "x"}'));
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent(
      m.profile_import_failed({ error: "metrics[1].scale: invalid type, expected f64" }),
    );
  expect(onImported).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
});

test("a later pick clears the earlier rejection", async () => {
  post.mockResolvedValueOnce({ error: { error: "name: missing" } });
  post.mockResolvedValueOnce({ data: { id: "acme-hybrid" } });
  render(ProfileImport, {});
  await picker().upload(file("{}"));
  await expect.element(page.getByRole("alert")).toBeVisible();
  await picker().upload(file());
  await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
});

test("an unreachable core reads as a failed request, not a crash", async () => {
  post.mockRejectedValue(new TypeError("fetch failed"));
  render(ProfileImport, {});
  await picker().upload(file());
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent(m.profile_import_failed({ error: m.conn_request_failed() }));
});

test("the picker is disabled while the file is posted and enabled again after", async () => {
  let settle: (answer: unknown) => void = () => {};
  post.mockReturnValue(new Promise((resolve) => (settle = resolve)));
  render(ProfileImport, {});
  await picker().upload(file());
  await expect.element(picker()).toBeDisabled();
  settle({ data: { id: "acme-hybrid" } });
  await expect.element(picker()).toBeEnabled();
});

test("the picker is emptied after a pick so the same file fires change again", async () => {
  post.mockResolvedValue({ error: { error: "name: missing" } });
  render(ProfileImport, {});
  await picker().upload(file());
  await expect.element(page.getByRole("alert")).toBeVisible();
  const input = (await picker().element()) as HTMLInputElement;
  await vi.waitFor(() => expect(input.files?.length).toBe(0));
  expect(input.value).toBe("");
});

test("the picker fits a phone and its target is tappable", async () => {
  await page.viewport(390, 844);
  render(ProfileImport, {});
  const box = (await picker().element()).getBoundingClientRect();
  expect(box.height).toBeGreaterThanOrEqual(36);
  expect(box.right).toBeLessThanOrEqual(390);
});
