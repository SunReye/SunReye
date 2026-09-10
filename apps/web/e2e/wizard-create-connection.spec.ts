/**
 * Settings → Devices → Add: creating the connection the wizard attaches to.
 *
 * A browser claim because the flow only exists in a running document: a native
 * `<select>` whose last option reveals a whole form, a kind switch that swaps
 * that form's fields AND re-keys the next step's catalog, a Next button whose
 * `disabled` follows a derived create body, and — the part no unit test can
 * reach — TWO requests in a fixed order, where the second one's address is the
 * first one's answer. The rules themselves (`add-wizard.test.ts`) are proven in
 * milliseconds; what only exists here is whether the bindings wire them up.
 *
 * The half-success is the case worth a browser at all: the endpoint written,
 * the thing on it refused. A silent one leaves a duplicate connection behind on
 * the next attempt, and the only place that is observable is the second press.
 */

import { expect, type Page, type Request, test } from "@playwright/test";
import { openPage } from "./support/open-page";

const open = (page: Page) => openPage(page, "/#/settings/devices/add");

const INTEGRATIONS = /\/api\/integrations$/;
const CONNECTIONS = /\/api\/connections$/;

/** The wizard's forward button, which becomes Add on the last step. */
const next = (page: Page) => page.getByRole("button", { name: "Next" });
const add = (page: Page) => page.getByRole("button", { name: "Add", exact: true });

/** Step 1, answered by creating a broker: pick the option, then fill the form. */
async function describeBroker(page: Page, url: string): Promise<void> {
  await page.locator("select#wizard-connection").selectOption("new");
  await page.locator("select#connection-kind").selectOption("mqtt");
  await page.getByLabel("Connection name").fill("Cellar broker");
  await page.getByLabel("Broker URL").fill(url);
}

/** Every POST body the page sent, in order, for one URL. */
function recordPosts(page: Page, match: RegExp): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = [];
  page.on("request", (request: Request) => {
    if (request.method() !== "POST" || !match.test(new URL(request.url()).pathname)) return;
    sent.push(request.postDataJSON() as Record<string, unknown>);
  });
  return sent;
}

test("the endpoint is created at FINISH, then the integration against the id it answered", async ({
  page,
}) => {
  const opened = await open(page);
  const connectionPosts = recordPosts(page, CONNECTIONS);
  const integrationPosts = recordPosts(page, INTEGRATIONS);

  // Step 1: the create option reveals the connection form, and nothing before.
  await expect(page.getByLabel("Connection name")).toHaveCount(0);
  await describeBroker(page, "mqtt://cellar.lan:1883");
  await expect(page.getByLabel("Broker URL")).toBeVisible();
  // The MQTT half only — the draft holds both, and only one is ever shown.
  await expect(page.getByLabel("Host")).toHaveCount(0);

  // Step 2 is the catalog for the kind being CREATED. No row exists to key it
  // by; the create arm's own kind is what the wizard asked the catalog with.
  await next(page).click();
  await expect(page.getByRole("button", { name: "EVCC" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Modbus device" })).toHaveCount(0);
  // …and never the auto-provisioned internal entry.
  await expect(page.getByRole("button", { name: "SunReye Optimizer" })).toHaveCount(0);

  await page.getByRole("button", { name: "EVCC" }).click();
  await next(page).click();
  await expect(page.getByLabel("Topic root")).toHaveValue("evcc");
  await page.getByLabel("Topic root").fill("garage");
  await next(page).click();

  // NOTHING has been written yet — the whole point of creating at finish. A
  // wizard abandoned here must leave no orphan endpoint behind.
  expect(connectionPosts).toEqual([]);

  await add(page).click();
  await expect(page.getByText("Added.")).toBeVisible();

  expect(connectionPosts).toEqual([
    { name: "Cellar broker", kind: "mqtt", params: { brokerUrl: "mqtt://cellar.lan:1883" } },
  ]);
  // The id is the one the CREATE answered with (the fixture's 9), not the
  // broker that already existed.
  expect(integrationPosts).toEqual([
    { kind: "evcc-ingest", connectionId: 9, params: { topicRoot: "garage" } },
  ]);
  await expect(page).toHaveURL(/#\/settings\/devices$/);
  expect(opened.consoleErrors).toEqual([]);
});

test("an abandoned wizard writes nothing, and Next holds until the form could be saved", async ({
  page,
}) => {
  await open(page);
  const connectionPosts = recordPosts(page, CONNECTIONS);

  await page.locator("select#wizard-connection").selectOption("new");
  // A nameless, address-less endpoint is not an answer to step 1.
  await expect(next(page)).toBeDisabled();
  await page.getByLabel("Connection name").fill("Cellar broker");
  await expect(next(page)).toBeDisabled();
  await page.locator("select#connection-kind").selectOption("mqtt");
  await page.getByLabel("Broker URL").fill("mqtt://cellar.lan:1883");
  await expect(next(page)).toBeEnabled();

  // Walk in, then walk out again: Cancel at step 2 writes nothing at all.
  await next(page).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/#\/settings\/devices$/);
  expect(connectionPosts).toEqual([]);
});

test("switching the kind re-keys the catalog and drops the entry picked under the old one", async ({
  page,
}) => {
  await open(page);
  await describeBroker(page, "mqtt://cellar.lan:1883");
  await next(page).click();
  await page.getByRole("button", { name: "EVCC" }).click();
  await next(page).click();
  await expect(page.getByLabel("Topic root")).toBeVisible();

  // Back to step 1 and onto a gateway: an EVCC ingest means nothing on a bus,
  // so step 2 must offer the Modbus arm with nothing pre-picked.
  await next(page).click();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await page.locator("select#connection-kind").selectOption("modbus");
  await page.getByLabel("Host").fill("10.0.0.9");

  await next(page).click();
  await expect(page.getByRole("button", { name: "Modbus device" })).toBeVisible();
  await expect(page.getByRole("button", { name: "EVCC" })).toHaveCount(0);
  // The entry went with the kind, so the wizard cannot advance yet.
  await expect(next(page)).toBeDisabled();
});

test("a created connection whose integration is refused says WHICH half happened, and is not created twice", async ({
  page,
}) => {
  await open(page);
  const connectionPosts = recordPosts(page, CONNECTIONS);
  const integrationPosts = recordPosts(page, INTEGRATIONS);

  // Registered after the fake backend, so this handler is the one that runs:
  // the endpoint is written, the thing on it is refused.
  let refuse = true;
  await page.route(
    (url) => INTEGRATIONS.test(url.pathname),
    async (route) => {
      if (route.request().method() !== "POST" || !refuse) return await route.fallback();
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        // The shape `admin-refusal.ts` answers with: `{ error, field }`.
        body: JSON.stringify({ error: "topic root already in use", field: "params" }),
      });
    },
  );

  await describeBroker(page, "mqtt://cellar.lan:1883");
  await next(page).click();
  await page.getByRole("button", { name: "EVCC" }).click();
  await next(page).click();
  await next(page).click();
  await add(page).click();

  // Named plainly: the connection exists, the rest did not happen. A bare
  // "could not add" reads as "nothing was saved" and earns a duplicate.
  await expect(page.getByText(/Cellar broker.*was created/)).toBeVisible();
  await expect(page.getByText(/topic root already in use/)).toBeVisible();
  // Still on the wizard — the operator's three other answers are not lost.
  await expect(page).toHaveURL(/#\/settings\/devices\/add$/);
  expect(connectionPosts).toHaveLength(1);

  // The retry attaches to the row that now exists rather than creating a
  // second endpoint with the same name.
  refuse = false;
  await add(page).click();
  await expect(page.getByText("Added.")).toBeVisible();
  expect(connectionPosts).toHaveLength(1);
  expect(integrationPosts).toEqual([
    { kind: "evcc-ingest", connectionId: 9, params: { topicRoot: "evcc" } },
    { kind: "evcc-ingest", connectionId: 9, params: { topicRoot: "evcc" } },
  ]);
});
