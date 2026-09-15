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
import { SOLARMAN_PORT, SOLARMAN_SERIAL } from "./support/api-fixtures";
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

/**
 * THE SOLARMAN ARM of the same create step.
 *
 * A browser claim because none of it is a value: the port moving when the
 * framing does, a field that exists only under one option of a native select,
 * and a probe answer writing back into an input the operator is looking at.
 * `connection-draft.test.ts` proves the port rule and the body in milliseconds;
 * what only exists here is whether the select, the reveal and the probe's write
 * are wired to them.
 *
 * The stick is why the framing exists at all: it ships in the box with most
 * Deye and Sunsynk hybrids, so for a large share of installs 8899 and a serial
 * are the only way to reach the inverter — and both are things the operator
 * should not have to know.
 */
test("picking Solarman moves the port, reveals the serial, and the probe fills it in", async ({
  page,
}) => {
  const opened = await open(page);
  const connectionPosts = recordPosts(page, CONNECTIONS);

  await page.locator("select#wizard-connection").selectOption("new");
  await page.locator("select#connection-kind").selectOption("modbus");
  await page.getByLabel("Connection name").fill("Logger stick");
  await page.getByLabel("Host").fill("10.0.0.8");

  // Before the framing is picked: 502, and no serial to ask about.
  await expect(page.locator("#connection-port")).toHaveValue("502");
  await expect(page.locator("#connection-logger-serial")).toHaveCount(0);

  await page.locator("select#connection-transport").selectOption("solarman-v5");
  await expect(page.locator("#connection-port")).toHaveValue(String(SOLARMAN_PORT));
  const serial = page.locator("#connection-logger-serial");
  await expect(serial).toBeVisible();
  // Empty, and saying so: the operator is not being asked for a number the test
  // is about to discover for them.
  await expect(serial).toHaveValue("");
  await expect(serial).toHaveAttribute("placeholder", /test the connection/i);

  // The probe answers with the stick's own serial, and the field takes it.
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(
    page.getByText(`Reachable — logger ${SOLARMAN_SERIAL} answered, 12 ms.`),
  ).toBeVisible();
  await expect(serial).toHaveValue(String(SOLARMAN_SERIAL));

  // And it rides the whole way to the request, framing and all.
  await next(page).click();
  await page.getByRole("button", { name: "Modbus device" }).click();
  await next(page).click();
  await describeMeter(page);
  await next(page).click();
  await add(page).click();
  await expect(page.getByText("Added.")).toBeVisible();

  expect(connectionPosts).toEqual([
    {
      name: "Logger stick",
      kind: "modbus",
      params: {
        host: "10.0.0.8",
        port: SOLARMAN_PORT,
        transport: "solarman-v5",
        timeoutMs: 2000,
        pollIntervalMs: 1000,
        loggerSerial: SOLARMAN_SERIAL,
      },
    },
  ]);
  expect(opened.consoleErrors).toEqual([]);
});

test("a hand-typed port survives the framing switch", async ({ page }) => {
  await open(page);
  await page.locator("select#wizard-connection").selectOption("new");
  await page.locator("select#connection-kind").selectOption("modbus");
  await page.getByLabel("Connection name").fill("Forwarded stick");
  await page.getByLabel("Host").fill("10.0.0.8");

  // A stick behind a port forward is a real arrangement. Losing that number to
  // a mis-click on the framing select would be found out at the next poll
  // failure, by someone sure they filled the field in correctly.
  await page.locator("#connection-port").fill("5020");
  await page.locator("select#connection-transport").selectOption("solarman-v5");
  await expect(page.locator("#connection-port")).toHaveValue("5020");
  await page.locator("select#connection-transport").selectOption("tcp");
  await expect(page.locator("#connection-port")).toHaveValue("5020");
  await expect(page.locator("#connection-logger-serial")).toHaveCount(0);
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

/**
 * FINDING THE UNIT ID, which is the one field on this screen nobody can read off
 * a label — and which does not mean the same thing on every framing. Measured on
 * one plant's two paths to ONE inverter: the Modbus-TCP gateway answers unit 0
 * and times out on 1, while the Solarman stick answers 1 and times out on 0.
 *
 * A browser claim because the whole feature is wiring: the request body, the
 * disabled state and the two lines are proven in `unit-scan-logic.test.ts`, and
 * what only exists in a running document is whether the answer reaches the
 * picker — the scan is worthless if it prints the id instead of selecting it.
 */
test.describe("finding the unit id", () => {
  test("a scan of the logger stick fills the picker in with the id that answered", async ({
    page,
  }) => {
    const opened = await open(page);
    // Step 1 on the stick's own row — the fake answers a scan of its address.
    await page.locator("select#wizard-connection").selectOption("3");
    await next(page).click();
    await page.getByRole("button", { name: "Modbus device" }).click();
    await next(page).click();

    const scan = page.getByRole("button", { name: "Find it" });
    // Nothing to ask with yet: a scan needs a register map, and step 3's profile
    // picker is still empty.
    await expect(scan).toBeDisabled();
    await expect(page.getByText(/Pick a gateway and a profile/)).toBeVisible();

    await page.locator("select#device-profile").selectOption("sungrow-sh10rt");
    await expect(scan).toBeEnabled();
    await scan.click();

    await expect(page.getByText(/Unit 1 answered in 82 ms/)).toBeVisible();
    await expect(page.locator("select#device-unit")).toHaveValue("1");
    expect(opened.consoleErrors).toEqual([]);
  });

  test("a scan that finds nothing names every id it ruled out, and changes no field", async ({
    page,
  }) => {
    const opened = await open(page);
    await reachDeviceStep(page);
    await page.locator("select#device-profile").selectOption("sungrow-sh10rt");

    await page.getByRole("button", { name: "Find it" }).click();

    await expect(page.getByText(/No answer on 1, 0, 2, 3, 4, 5/)).toBeVisible();
    // Still the lowest free id on that gateway — a failed scan must not "tidy"
    // the field it could not answer.
    await expect(page.locator("select#device-unit")).toHaveValue("0");
    expect(opened.consoleErrors).toEqual([]);
  });

  test("the help text says what the number addresses on THIS framing", async ({ page }) => {
    await open(page);
    await reachDeviceStep(page);
    // The fixture's gateway is plain Modbus TCP: the gateway decides.
    await expect(page.getByText(/The gateway decides what this addresses/)).toBeVisible();
    await expect(page.getByText(/inverter's own slave address/)).toHaveCount(0);
  });
});
