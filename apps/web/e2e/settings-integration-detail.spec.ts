/**
 * Settings → an integration's own page (`/settings/integrations/:id`).
 *
 * The owner's second question, verbatim: "why is it not like in homeassistant.
 * Where you have a list of integrations like evcc and when you click into it you
 * see all the loadpoints and roles and data?" An integration used to have no
 * inside at all — a row with three controls and nowhere to answer "what is EVCC
 * actually giving me".
 *
 * A browser claim because everything on it is a resolved document: two payloads
 * that arrive separately and have to be joined (the row from
 * `/api/integrations`, its devices from `/api/devices`), a settings form seeded
 * from the row rather than from the catalog's defaults, a live reading that only
 * exists once the socket is leased, and a Remove that has to leave a page that
 * no longer has a subject. What each function DECIDES is proven in milliseconds
 * (`integration-detail.test.ts`); what only exists here is whether the page
 * wires them together.
 */

import { expect, type Page, test } from "@playwright/test";
import { openPage } from "./support/open-page";

/** The EVCC ingest — connected, with a healed failure behind it (fixture id 1). */
const openEvcc = (page: Page) => openPage(page, "/#/settings/integrations/1");
/** The Home Assistant export — disabled, and never once connected (fixture id 2). */
const openExport = (page: Page) => openPage(page, "/#/settings/integrations/2");

test("the page names the integration, its live state and the endpoint it runs over", async ({
  page,
}) => {
  const opened = await openEvcc(page);
  await expect(page.getByRole("heading", { level: 2, name: "EVCC", exact: true })).toBeVisible();

  const status = page.locator("[data-integration-status]");
  // A healthy endpoint carries no pill — neither "Connected" nor "Enabled". The
  // page still reports it, in the line that says WHEN it last connected, which
  // is the sentence with something in it: OBSERVED from the broker pool, not
  // derived from "a broker id is set".
  await expect(status.getByText("Connected", { exact: true })).toHaveCount(0);
  await expect(status.getByText("Enabled", { exact: true })).toHaveCount(0);
  await expect(status.getByText(/Last connected/)).toBeVisible();

  // A healed failure is still shown: it is the whole content of "it reconnects
  // every ten minutes", and a red pill with nothing to act on is not a status.
  await expect(status.locator("[data-last-error]")).toContainText("ECONNREFUSED hass.ee.lan:1883");

  // The connection leads BACK to the devices page. That page answers "why is
  // nothing arriving" — a connection is the thing that fails — and this one
  // answers "what is this giving me". Neither collapses into the other.
  await expect(status.getByRole("link", { name: "Home broker" })).toBeVisible();
  expect(opened.backend.unhandled).toEqual([]);
  expect(opened.consoleErrors).toEqual([]);
});

/**
 * "Never connected" is not a quieter "not connected".
 *
 * They are different faults with different fixes — a broker that has gone away
 * versus one these credentials never reached — and an operator told the wrong
 * one looks in the wrong place. The export fixture has never opened once.
 */
test("an endpoint that has never opened says exactly that, and reports no error", async ({
  page,
}) => {
  const opened = await openExport(page);
  const status = page.locator("[data-integration-status]");
  await expect(status.getByText("Never connected")).toBeVisible();
  await expect(status.getByText("Disabled", { exact: true })).toBeVisible();
  await expect(status.locator("[data-last-error]")).toHaveCount(0);
  await expect(status.getByText(/Last connected/)).toHaveCount(0);
  await expect(status.getByText("Nothing has failed yet.")).toBeVisible();
  expect(opened.consoleErrors).toEqual([]);
});

/**
 * THE ANSWER TO "WHAT IS EVCC GIVING ME".
 *
 * Both loadpoints, each with its role, and — here, where identifiers belong —
 * the slug and the index it is addressed by. The devices page dropped those from
 * its rows; it did not delete the facts, it moved them.
 */
test("it lists the devices it provides, with their roles and how they are addressed", async ({
  page,
}) => {
  const opened = await openEvcc(page);
  const rows = page.locator("[data-provided] [data-provided-device]");
  await expect(rows).toHaveCount(2);

  const carport = page.locator("[data-provided-device='evcc-loadpoint-1']");
  await expect(carport.getByText("Carport")).toBeVisible();
  await expect(carport.getByText("Charger")).toBeVisible();
  await expect(carport.getByText("evcc-loadpoint-1")).toBeVisible();
  // An INDEX, not a "Unit": a loadpoint's position in EVCC's own config is not
  // a slave id on a wire, and calling both the same word is what blurred them.
  await expect(carport.getByText("Index 0")).toBeVisible();
  await expect(
    page.locator("[data-provided-device='evcc-loadpoint-2']").getByText("Index 1"),
  ).toBeVisible();
  expect(opened.backend.unhandled).toEqual([]);
  expect(opened.consoleErrors).toEqual([]);
});

// The Home Assistant export publishes and provisions nothing. An empty list
// with no words in it would read as a page that failed to load.
test("an integration that provides nothing says so", async ({ page }) => {
  await openExport(page);
  await expect(page.getByText("This integration provides no devices yet.")).toBeVisible();
  await expect(page.locator("[data-provided-device]")).toHaveCount(0);
});

/**
 * The live half, and the one thing it must not do.
 *
 * `$lib/live/ownership.ts` names plant-wide ids only, so `evcc.charge.power` is
 * every loadpoint's power summed. That is the integration's number, and it is
 * labelled as the integration's; a copy of it beside each loadpoint would be a
 * per-row figure that is really a total, which is the exact shape of the bug
 * `ownership.ts` was written after.
 */
test("the live reading is the integration's, and is not restated per device", async ({ page }) => {
  const opened = await openEvcc(page);
  const reading = page.locator("[data-reading='evcc.charge.power']");
  await expect(reading).toBeVisible();
  await expect(reading.getByText("Charge power")).toBeVisible();
  // The fixture's EVCC state is charging, so the socket produces a number rather
  // than the em dash an absent owner would leave.
  await expect(reading).toContainText(/\d/);
  await expect(page.getByText("Reported for the whole integration, not per device.")).toBeVisible();

  // No device row carries a reading of its own — there is no id it could own.
  await expect(page.locator("[data-provided-device] [data-reading]")).toHaveCount(0);
  expect(opened.consoleErrors).toEqual([]);
});

// The export measures nothing at all, and a tile with no number in it would
// claim it has one that has not arrived.
test("an integration that measures nothing shows no readings", async ({ page }) => {
  await openExport(page);
  await expect(page.getByText("This integration reports no live values.")).toBeVisible();
  await expect(page.locator("[data-reading]")).toHaveCount(0);
});

/**
 * The settings are the WIZARD'S step over the SERVER'S field description — no
 * field is restated here, which is what keeps the form from offering something
 * the route then refuses.
 */
test("its settings are seeded from the row and saved as params", async ({ page }) => {
  const opened = await openEvcc(page);
  const topicRoot = page.getByLabel("Topic root");
  // Seeded from the ROW, not from the catalog's default: a form that reset to
  // `evcc` would silently undo an operator's topic root on the next save.
  await expect(topicRoot).toHaveValue("evcc");
  await topicRoot.fill("wallbox");

  const request = page.waitForRequest(
    (r) => r.method() === "PATCH" && r.url().includes("/api/integrations/1"),
  );
  await page.getByRole("button", { name: "Save" }).click();
  const sent = await request;
  // Never a `kind` or a `connectionId`: those are the row's identity and the
  // server answers 409 for either.
  expect(sent.postDataJSON()).toEqual({ params: { topicRoot: "wallbox" } });
  await expect(page.getByText("EVCC saved.")).toBeVisible();
  expect(opened.backend.unhandled).toEqual([]);
  expect(opened.consoleErrors).toEqual([]);
});

test("the switch turns it off with a PATCH carrying nothing but `enabled`", async ({ page }) => {
  const opened = await openEvcc(page);
  const request = page.waitForRequest(
    (r) => r.method() === "PATCH" && r.url().includes("/api/integrations/1"),
  );
  await page.getByRole("switch", { name: "EVCC" }).click();
  expect((await request).postDataJSON()).toEqual({ enabled: false });
  await expect(page.getByText("EVCC saved.")).toBeVisible();
  expect(opened.consoleErrors).toEqual([]);
});

/**
 * Remove is the same confirm the devices page shows, for the same reason: a
 * DELETE retires the loadpoints, because their readings are a foreign key away
 * from a year of `metrics_raw` rows.
 *
 * And afterwards the page leaves. Staying would be a detail view of a row that
 * no longer exists — the "not configured" copy over the thing just deleted.
 */
test("Remove names what it retires, then leaves for the list", async ({ page }) => {
  const opened = await openEvcc(page);
  await page.getByRole("button", { name: "Remove" }).click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByRole("heading", { name: "Remove EVCC?" })).toBeVisible();
  const warning = panel.locator("[data-retires]");
  await expect(warning).toContainText("Carport");
  await expect(warning).toContainText("Garage");

  const request = page.waitForRequest(
    (r) => r.method() === "DELETE" && r.url().includes("/api/integrations/1"),
  );
  await panel.getByRole("button", { name: "Remove" }).click();
  await request;
  await expect(page).toHaveURL(/#\/settings\/devices$/);
  await expect(page.getByText("EVCC removed.")).toBeVisible();
  expect(opened.consoleErrors).toEqual([]);
});

/**
 * 400px, where the German strings are the long ones.
 *
 * The page is the deepest nest in the settings area — a card, a divided list,
 * and inside each row a name, a role badge, a state badge and a mono slug — so
 * it is the most likely thing here to push the document sideways. A resolved
 * layout, so a browser claim: `display: flex` on a row is what says the
 * stylesheet actually landed (an unstyled Vite document is all `display: block`,
 * which is the very shape a passing case would otherwise be measuring).
 */
test("the page does not scroll sideways at 400px", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 844 });
  await openEvcc(page);
  const row = page.locator("[data-provided-device='evcc-loadpoint-1']");
  await expect(row).toBeVisible();
  await expect(row).toHaveCSS("display", "flex");

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - window.innerWidth,
    body: document.body.scrollWidth - window.innerWidth,
  }));
  // 1px of rounding, not a column of content.
  expect(overflow.document).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
});

// The id comes off a URL, so this is reachable by typing — and "not yet loaded"
// must not be shown as "gone", which is why the copy waits for the list.
test("an id nothing is configured under says so rather than rendering an empty page", async ({
  page,
}) => {
  const opened = await openPage(page, "/#/settings/integrations/999");
  await expect(
    page.getByText("No integration with this id is configured on this plant."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "All devices" })).toBeVisible();
  expect(opened.backend.unhandled).toEqual([]);
  expect(opened.consoleErrors).toEqual([]);
});
