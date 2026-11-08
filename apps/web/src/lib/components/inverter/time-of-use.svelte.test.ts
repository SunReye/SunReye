import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import * as m from "$lib/paraglide/messages";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.hoisted(() => vi.fn());
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));
vi.mock("$lib/engine-only", () => ({ postSetting: vi.fn() }));

const { coreCapabilities } = await import("$lib/capabilities.svelte");
const { default: TimeOfUse } = await import("./time-of-use.svelte");

const title = () => page.getByText(m.tou_schedule_title());

afterEach(() => get.mockReset());

test("offers the schedule editor while the core serves controls", async () => {
  get.mockResolvedValue({ data: { controls: true } });
  await coreCapabilities.load();
  render(TimeOfUse);
  await expect.element(title()).toBeVisible();
});

test("no schedule editor when the core reports controls absent", async () => {
  get.mockResolvedValue({ data: { controls: false } });
  await coreCapabilities.load();
  render(TimeOfUse);
  await expect.element(title()).not.toBeInTheDocument();
});
