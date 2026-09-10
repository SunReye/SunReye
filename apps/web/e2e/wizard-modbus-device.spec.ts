/**
 * Settings → Devices → Add, THE MODBUS ARM: adding a device through the wizard.
 *
 * The arm was dead. Step 3 rendered every entry through the catalog-field
 * renderer, which is right for a coded integration's two or three scalars and
 * wrong for a device: it printed "arrays: array" and "battery: object" (the
 * only thing it can do with a shape it has no control for), offered a free-text
 * box where the profile picker belongs, and asked for no NAME at all — which
 * `POST /api/devices` requires. Nothing that could be typed into that screen
 * was a body the route would accept.
 *
 * A browser claim because the fix is a wiring one: the RULES are proven in
 * milliseconds by `add-wizard.test.ts`, and what only exists in a running
 * document is whether step 3 mounts the add dialog's own fields, whether their
 * bindings reach the wizard's state, whether Next follows the form's own answer
 * to "could this be submitted", and — for the create arm — whether the device
 * ends up addressed at the gateway the FIRST request answered with.
 */

import { expect, type Page, type Request, test } from "@playwright/test";
import { openPage } from "./support/open-page";

const open = (page: Page) => openPage(page, "/#/settings/devices/add");

const DEVICES = /\/api\/devices$/;
const CONNECTIONS = /\/api\/connections$/;

const next = (page: Page) => page.getByRole("button", { name: "Next" });
const add = (page: Page) => page.getByRole("button", { name: "Add", exact: true });

/** Every POST body the page sent, in order, for one URL. */
function recordPosts(page: Page, match: RegExp): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = [];
  page.on("request", (request: Request) => {
    if (request.method() !== "POST" || !match.test(new URL(request.url()).pathname)) return;
    sent.push(request.postDataJSON() as Record<string, unknown>);
  });
  return sent;
}

/** Steps 1 and 2, answered on the gateway that already exists. */
async function reachDeviceStep(page: Page): Promise<void> {
  await page.locator("select#wizard-connection").selectOption("1");
  await next(page).click();
  await page.getByRole("button", { name: "Modbus device" }).click();
  await next(page).click();
}

/** Step 3, filled in as a meter — the role with no roof and no pack. */
async function describeMeter(page: Page): Promise<void> {
  await page.locator("select#device-role").selectOption("meter");
  await page.locator("#device-name").fill("Cellar meter");
  await page.locator("select#device-profile").selectOption("sungrow-sh10rt");
}

test("step 3 asks for a DEVICE — not the catalog's shapes, and never without a name", async ({
  page,
}) => {
  const opened = await open(page);
  await reachDeviceStep(page);

  // The add dialog's own fields, all four of them.
  await expect(page.locator("#device-name")).toBeVisible();
  await expect(page.locator("select#device-profile")).toBeVisible();
  await expect(page.locator("select#device-role")).toBeVisible();
  await expect(page.locator("select#device-unit")).toBeVisible();

  // And NOT the generic renderer's unsupported-type report, which is what the
  // catalog's `arrays` and `battery` fields produced here. That report is
  // correct behaviour — it was being asked the wrong question.
  await expect(page.getByText("arrays: array")).toHaveCount(0);
  await expect(page.getByText("battery: object")).toHaveCount(0);
  // `profileId` is a picker, not the text box the generic renderer drew for a
  // field the server describes as a string.
  await expect(page.locator("input#profileId")).toHaveCount(0);

  // The unit id is seeded to the lowest one free ON THIS gateway: 1 and 2 are
  // in service there, and 3 is only held by a RETIRED row, which frees it.
  await expect(page.locator("select#device-unit")).toHaveValue("0");
  await expect(page.locator("select#device-unit option[value='1']")).toBeDisabled();
  await expect(page.locator("select#device-unit option[value='3']")).toBeEnabled();

  // Next follows the form's own answer. Without a name and a profile the add is
  // a 400 the operator has no field to fix, so the step holds.
  await expect(next(page)).toBeDisabled();
  await page.locator("#device-name").fill("Cellar meter");
  await expect(next(page)).toBeDisabled();
  await page.locator("select#device-profile").selectOption("sungrow-sh10rt");
  await expect(next(page)).toBeEnabled();

  // A name that slugifies to nothing is refused here rather than by the server.
  await page.locator("#device-name").fill("###");
  await expect(next(page)).toBeDisabled();

  expect(opened.consoleErrors).toEqual([]);
});

test("the inverter's roof and pack appear for an inverter and for no other role", async ({
  page,
}) => {
  await open(page);
  await reachDeviceStep(page);

  // `inverter` is the form's default, and it is the only role the server takes
  // PV fields for.
  await expect(page.getByRole("button", { name: "Add array" })).toBeVisible();
  await page.locator("select#device-role").selectOption("meter");
  await expect(page.getByRole("button", { name: "Add array" })).toHaveCount(0);
});

test("the confirm step summarises the device, and Add posts the body the route accepts", async ({
  page,
}) => {
  const opened = await open(page);
  const posts = recordPosts(page, DEVICES);

  await reachDeviceStep(page);
  await describeMeter(page);
  await next(page).click();

  // Named, not dumped: the old step ran `String()` over the answers bag, which
  // for a device reads "[object Object]".
  await expect(page.getByText("Cellar meter")).toBeVisible();
  await expect(page.getByText("Sungrow SH10RT")).toBeVisible();
  await expect(page.getByText("[object Object]")).toHaveCount(0);

  await add(page).click();
  await expect(page.getByText("Added.")).toBeVisible();

  // A meter carries no arrays and no pack: the server refuses those on any role
  // but `inverter`, so the body must not offer them.
  expect(posts).toEqual([
    {
      via: "profile",
      connection: { id: 1 },
      role: "meter",
      unitId: 0,
      name: "Cellar meter",
      profileId: "sungrow-sh10rt",
    },
  ]);
  await expect(page).toHaveURL(/#\/settings\/devices$/);
  expect(opened.consoleErrors).toEqual([]);
});

test("a device on a gateway created in the same wizard is addressed at the id that came back", async ({
  page,
}) => {
  await open(page);
  const connectionPosts = recordPosts(page, CONNECTIONS);
  const devicePosts = recordPosts(page, DEVICES);

  // Step 1 describes a gateway that does not exist yet.
  await page.locator("select#wizard-connection").selectOption("new");
  await page.locator("select#connection-kind").selectOption("modbus");
  await page.getByLabel("Connection name").fill("Cellar gateway");
  await page.getByLabel("Host").fill("10.0.0.9");
  await next(page).click();
  await page.getByRole("button", { name: "Modbus device" }).click();
  await next(page).click();

  // Nothing is addressed on a row that does not exist, so every unit id is free.
  await expect(page.locator("select#device-unit")).toHaveValue("0");
  await describeMeter(page);
  await next(page).click();

  // Still nothing written — the endpoint is created at FINISH.
  expect(connectionPosts).toEqual([]);
  await add(page).click();
  await expect(page.getByText("Added.")).toBeVisible();

  expect(connectionPosts).toHaveLength(1);
  // The id the CREATE answered with (the fixture's 9), never the sentinel the
  // form was seeded with — which would have asked the route to make a SECOND
  // gateway out of the form's own blank draft.
  expect(devicePosts).toEqual([
    {
      via: "profile",
      connection: { id: 9 },
      role: "meter",
      unitId: 0,
      name: "Cellar meter",
      profileId: "sungrow-sh10rt",
    },
  ]);
});
