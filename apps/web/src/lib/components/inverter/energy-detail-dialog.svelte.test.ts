import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import EnergyDetailDialogFixture from "./energy-detail-dialog.fixture.svelte";

vi.mock("$env/dynamic/public", () => ({ env: {} }));
const get = vi.hoisted(() => vi.fn());
vi.mock("$lib/core-api", () => ({ core: { GET: get } }));
vi.mock("$lib/api", () => ({ api: new Proxy({}, { get: () => assertNoEden }) }));
function assertNoEden(): never {
  throw new Error("the energy detail dialog reached Eden");
}

afterEach(() => get.mockReset());

test("reads today's hourly series from the core when it opens", async () => {
  get.mockResolvedValue({ data: [] });
  render(EnergyDetailDialogFixture);
  expect(get).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Open detail" }).click();
  await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  const [path, init] = get.mock.calls[0];
  expect(path).toBe("/api/energy/series");
  expect(init.params.query.bucket).toBe("hour");
  expect(init.params.query.source).toBe("plant");
  expect(Date.parse(init.params.query.from)).toBeLessThanOrEqual(Date.parse(init.params.query.to));
});
