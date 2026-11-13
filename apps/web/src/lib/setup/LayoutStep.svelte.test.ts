import "../../app.css";
import { afterEach, beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect } from "../api/core.ts";
import { DEVICES, MODULE, phone, tap, undesk } from "../builder/builder.harness.ts";
import LayoutStep from "./LayoutStep.svelte";

// Setup's layout step on a phone (ADR 20, 21): its title whole, the canvas's notices apart.

/** A core that knows one module type; everything else stays unanswered. */
const core = () =>
  connect({
    base: "http://core.test/",
    fetch: (request) =>
      request.url.endsWith("/api/v1/module-types")
        ? Promise.resolve(Response.json({ moduleTypes: [MODULE] }))
        : Promise.withResolvers<Response>().promise,
  });

function step() {
  return render(LayoutStep, {
    core: core(),
    devices: DEVICES,
    step: 4,
    count: 5,
    onback: () => {},
    ondone: () => {},
  });
}

const apart = (a: Readonly<DOMRect>, b: Readonly<DOMRect>): boolean =>
  a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;

beforeEach(phone);

afterEach(async () => {
  await undesk();
  localStorage.removeItem("sunreye.builder.view");
});

test.each([390, 320])("at %i px the step's title shows in full", async (width) => {
  await page.viewport(width, 844);
  await step();

  const title = page.getByRole("heading", { name: "PV-Anlage" });

  await expect.element(title).toBeVisible();

  const shown = title.element();

  expect(shown.scrollWidth).toBeLessThanOrEqual(shown.clientWidth);
  expect(shown.getBoundingClientRect().right).toBeLessThanOrEqual(width);
});

test("the canvas's status line keeps apart from the tools and the inspector", async () => {
  await step();
  await tap(page.getByRole("button", { name: "Einfamilienhaus mit Satteldach" }));
  await tap(page.getByRole("button", { name: "Hinzufügen" }));
  await tap(page.getByRole("button", { name: "String hinzufügen" }));
  // Down again, to look at the canvas.
  await tap(page.getByRole("button", { name: "Szene bearbeiten" }));

  // One status line holds the notices: what does not fit scrolls inside it.
  const status = page.getByRole("group", { name: "Jetzt in der Szene" });

  await expect.element(status.getByText(/^Ohne den Standort der Anlage/u)).toBeInTheDocument();
  await expect.element(status.getByRole("list", { name: "Leistung je String" })).toBeVisible();

  const notices = [
    status,
    page.getByRole("toolbar", { name: "Werkzeuge" }),
    page.getByRole("region", { name: "Szene bearbeiten" }),
  ];

  for (const notice of notices) {
    // oxlint-disable-next-line no-await-in-loop -- each must be on screen before it is measured.
    await expect.element(notice).toBeVisible();
  }

  await expect
    .element(page.getByRole("button", { name: "Szene bearbeiten" }))
    .toHaveAttribute("aria-expanded", "false");

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- vitest's locators, read only.
  const boxes = notices.map((notice) => notice.element().getBoundingClientRect());

  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) expect(apart(a, b)).toBe(true);
  }
});
