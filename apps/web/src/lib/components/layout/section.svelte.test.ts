import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import SectionFixture from "./section.fixture.svelte";

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 800 };

/** A tap `dx`/`dy` off the centre of `el` lands on `el` (or inside it). */
function hitsAround(el: Element, reach: number): boolean {
  const box = el.getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  return (
    [
      [reach, 0],
      [-reach, 0],
      [0, reach],
      [0, -reach],
    ] as const
  ).every(([dx, dy]) => el.contains(document.elementFromPoint(cx + dx, cy + dy)));
}

afterEach(async () => {
  await page.viewport(LAPTOP.width, LAPTOP.height);
});

describe("a collapsible section", () => {
  test("shows its content before any open state is decided", async () => {
    // `open` left unset means a stored preference is still in flight — the
    // content shows rather than blanking out and popping back in.
    render(SectionFixture, { title: "Energy", collapsible: true });
    await expect.element(page.getByText("Section body")).toBeVisible();
  });

  test("folds away on the caret and unmounts what it hid", async () => {
    render(SectionFixture, { title: "Energy", collapsible: true });
    const caret = page.getByRole("button", { name: /Energy/ });
    await caret.click();
    // Unmounted, not hidden: a closed section must stop driving its fetches.
    await expect.element(page.getByText("Section body")).not.toBeInTheDocument();
    await caret.click();
    await expect.element(page.getByText("Section body")).toBeVisible();
  });

  test("the caret is a 44px target around its 16px icon", async () => {
    await page.viewport(PHONE.width, PHONE.height);
    render(SectionFixture, { title: "Energy", collapsible: true });
    const caret = page.getByRole("button", { name: /Energy/ }).element();
    // 20px off centre is inside a 44px box and well outside the 16px icon.
    expect(hitsAround(caret, 20)).toBe(true);
  });

  test("a section that cannot collapse offers no caret", async () => {
    render(SectionFixture, { title: "Energy" });
    await expect.element(page.getByText("Section body")).toBeVisible();
    expect(page.getByRole("button", { name: /Energy/ }).elements()).toHaveLength(0);
  });
});

describe("the header row at phone width", () => {
  const LONG = "PV-Spitzenkappung & Prognoseladen mit einem noch längeren Titel";

  test("a long title wraps and the controls stay hard right inside the card", async () => {
    await page.viewport(PHONE.width, PHONE.height);
    render(SectionFixture, { title: LONG, collapsible: true, withActions: true });

    const section = document.querySelector("section")!;
    const card = section.getBoundingClientRect();
    const button = page.getByRole("button", { name: "Add device" }).element();
    const caret = page.getByRole("button", { name: /PV-Spitzenkappung/ }).element();
    const heading = page.getByRole("heading", { name: LONG }).element();

    // Nothing runs off the side of a 390px screen.
    expect(card.right).toBeLessThanOrEqual(PHONE.width);
    // (Not `scrollWidth`: the caret's invisible TAP pseudo-element reaches a
    // pixel past the card edge by design, and that is not overflow anyone sees.)
    for (const el of [button, caret, heading]) {
      expect(el.getBoundingClientRect().right).toBeLessThanOrEqual(card.right);
    }
    // The caret ends the row, flush against the card's padding edge.
    const padRight = Number.parseFloat(getComputedStyle(section).paddingRight);
    const border = Number.parseFloat(getComputedStyle(section).borderRightWidth);
    expect(Math.round(caret.getBoundingClientRect().right)).toBe(
      Math.round(card.right - padRight - border),
    );
    // The title gave way by wrapping, not by an ellipsis eating its end.
    expect(heading.getBoundingClientRect().height).toBeGreaterThan(30);
    expect(heading.scrollWidth).toBeLessThanOrEqual(heading.clientWidth);
  });

  test("a short title leaves the controls hard right too, not centred", async () => {
    await page.viewport(PHONE.width, PHONE.height);
    render(SectionFixture, { title: "Energy", collapsible: true, withActions: true });
    const section = document.querySelector("section")!;
    const actions = section.querySelector("[data-slot=section-actions]")!;
    const heading = page.getByRole("heading", { name: "Energy" }).element();
    // Same row as the title, and the title column owns everything to its left.
    expect(actions.getBoundingClientRect().top).toBeCloseTo(
      heading.getBoundingClientRect().top,
      -1,
    );
    expect(heading.getBoundingClientRect().right).toBeLessThanOrEqual(
      actions.getBoundingClientRect().left,
    );
  });
});

describe("a section that offers full screen", () => {
  test("the plot's corner control takes the card, and the chart, to the whole screen", async () => {
    render(SectionFixture, { title: "Energy", fullscreen: true });
    const plot = page.getByTestId("plot").element();
    const before = plot.getBoundingClientRect().height;
    expect(before).toBeLessThan(300);

    await page.getByRole("button", { name: "Full screen" }).click();

    const section = document.querySelector("section")!;
    await expect.poll(() => section.getBoundingClientRect().height).toBe(window.innerHeight);
    expect(section.getBoundingClientRect().width).toBe(window.innerWidth);
    // The chart box itself grew: its fixed CHART_BOX height lost to the
    // expanded rules. A class name with no generated rule behind it leaves this
    // at 256px inside a full-screen card.
    expect(plot.getBoundingClientRect().height).toBeGreaterThan(window.innerHeight / 2);

    await page.getByRole("button", { name: "Exit full screen" }).click();
    await expect.poll(() => plot.getBoundingClientRect().height).toBe(before);
  });
});
