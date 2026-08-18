/**
 * What the dashboard does when a payload is ABSENT, and what it does when one
 * ARRIVES LATE.
 *
 * ## Why this is a second file and not more rows in the census
 *
 * `page-smoke.spec.ts` opens every route once against a fully populated
 * backend: its question is "does this page render its own payloads". The
 * questions here are the other two, and both need a differently-configured
 * backend per case:
 *
 *  - **Absent.** Half of this app's endpoints legally answer `null`, Elysia
 *    sends that as an EMPTY BODY, Eden hands it back as `""`, and `""` is not
 *    nullish — so `data ?? null` keeps it and every `if (data)` downstream
 *    passes on a feature that is switched off. The components that own those
 *    payloads self-hide, which means the failure is a tile that is simply not
 *    there: no error, no console line, nothing for the census to trip over.
 *    Asserting the populated case can never catch a self-hide that fires too
 *    eagerly, because the two look the same from the other side.
 *  - **Late.** Three topics paint from the socket, and the census only ever
 *    sees their subscribe-time backfill. A card that renders its first frame
 *    and then ignores every later one is a live dashboard frozen at boot —
 *    invisible to anything that looks once.
 *
 * Every one of these also runs the mock's own switches (`weather: null`,
 * `prices: null`, `evcc: null`, `role: "user"`, `pushEvcc`, `pushAutomations`).
 * That is deliberate: an unexercised branch of the fake backend is untested
 * code that a spec will one day trust.
 */

import { expect, test } from "@playwright/test";
import * as fixture from "./support/api-fixtures";
import { evChargerCard, openPage } from "./support/open-page";

test("weather switched off leaves no tile behind, not an unreadable one", async ({ page }) => {
  // `/api/weather` answers an EMPTY BODY, which is the transport detail that
  // makes this dangerous: a `""` kept by `?? null` renders "NaN undefined" on a
  // wall display nobody is watching. `isReadableWeather` is what stops it.
  const opened = await openPage(page, "/#/", { weather: null });

  await expect(page.getByText("Berlin")).toBeHidden();
  await expect(page.getByText("NaN")).toBeHidden();
  // The tile is gone, and the page beside it is not: the EV card and the
  // diagram still render, so this is a hidden tile rather than a broken column.
  await expect(evChargerCard(page)).toBeVisible();
  expect(opened.consoleErrors).toEqual([]);
  expect(opened.backend.unhandled).toEqual([]);
});

test("EVCC off sends no evcc frame at all, and the card stays away", async ({ page }) => {
  // The server does not send `{topic:"evcc", data:null}` — `ws-priming.ts` skips
  // the snapshot entirely when there is nothing to send, so "off" is silence.
  const opened = await openPage(page, "/#/", { evcc: null });

  await expect(evChargerCard(page)).toBeHidden();
  await expect(page.getByText("EV charging")).toBeHidden();
  // The rest of the right-hand column is unaffected.
  await expect(page.getByText("Berlin")).toBeVisible();
  expect(opened.consoleErrors).toEqual([]);
});

test("no price feed drops the whole spot-prices section", async ({ page }) => {
  // `section-list.svelte` gates the section on `spotStats.available`, so this
  // is capability gating rather than a preference: the section, its charts and
  // its customize toggle all go together.
  const opened = await openPage(page, "/#/statistics", { prices: null });

  await expect(page.getByRole("heading", { level: 2, name: "Costs & savings" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Spot prices" })).toBeHidden();
  await expect(page.getByText("Negative hours")).toBeHidden();
  expect(opened.consoleErrors).toEqual([]);
  expect(opened.backend.unhandled).toEqual([]);
});

test("a non-admin session is refused the admin topics by name", async ({ page }) => {
  // `TOPIC_POLICY` (routes/ws-topics.ts) gates `logs` and `automations` on an
  // admin session and never lets them ride the public-dashboard exemption. The
  // automations index is reachable by any signed-in user, so it is where a
  // client-side assumption of "subscribed means granted" would show.
  const opened = await openPage(page, "/#/automations", { role: "user" });

  const card = page.getByRole("link", { name: /PV peak shaving/ });
  await expect(card).toBeVisible();
  // `peakShaving?.state ?? 'disabled'` — with the topic refused there is no
  // status, so the badge reads the disabled label rather than "Idle".
  await expect(card).toContainText("Off");
  await expect.poll(() => [...opened.backend.deniedTopics]).toContain("automations");
  expect(opened.consoleErrors).toEqual([]);
});

test("a live evcc frame moves the card that the backfill painted", async ({ page }) => {
  const opened = await openPage(page, "/#/");
  const card = evChargerCard(page);
  await expect(card).toContainText("Charging");

  // The car finished: same loadpoint, still plugged in, no longer charging.
  const parked = {
    ...fixture.EVCC_STATE,
    loadpoints: [{ ...fixture.EVCC_STATE.loadpoints[0], charging: false, mode: "off" }],
  };
  await opened.backend.pushEvcc(parked);

  await expect(card).toContainText("Plugged in");
  await expect(card).not.toContainText("Charging");
});

test("a live automations frame moves the run-state badge", async ({ page }) => {
  const opened = await openPage(page, "/#/automations");
  const card = page.getByRole("link", { name: /PV peak shaving/ });
  await expect(card).toContainText("Idle");

  const base = fixture.automationStream();
  await opened.backend.pushAutomations({
    ...base,
    status: { ...base.status, state: "active", targetA: 42 },
  });

  await expect(card).toContainText("Active");
});
