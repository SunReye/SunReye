// The shared presses play their haptic once, on the user's press, and never as their props change
// (ADR 21 "One behaviour, one component").
import { createRawSnippet } from "svelte";
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { haptics } from "@sunreye/ui/haptics";
import AddButton from "./add-button.svelte";
import NavLink from "./nav-link.svelte";
import OpenRow from "./open-row.svelte";
import RemovableChip from "./removable-chip.svelte";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Followed, a link would leave the test's page. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's event.
const stay = (event: MouseEvent) => {
  event.preventDefault();
};

const children = createRawSnippet(() => ({ render: () => "<span>Süd</span>" }));

test("a chip's remove plays light once and removes", async () => {
  const light = vi.spyOn(haptics, "light");
  const onremove = vi.fn<() => void>();
  const screen = await render(RemovableChip, { remove: "Süd entfernen", onremove, children });

  await screen.rerender({ remove: "Nord entfernen" });
  expect(light).not.toHaveBeenCalled();

  await page.getByRole("button", { name: "Nord entfernen" }).click();

  expect(onremove).toHaveBeenCalledOnce();
  expect(light).toHaveBeenCalledOnce();
});

test("an add button plays light once and adds", async () => {
  const light = vi.spyOn(haptics, "light");
  const onadd = vi.fn<() => void>();
  const screen = await render(AddButton, { text: "Reihe", onadd });

  await screen.rerender({ text: "Gestern" });
  expect(light).not.toHaveBeenCalled();

  await page.getByRole("button", { name: "Gestern" }).click();

  expect(onadd).toHaveBeenCalledOnce();
  expect(light).toHaveBeenCalledOnce();
});

test("a row that opens plays soft once and opens", async () => {
  const soft = vi.spyOn(haptics, "soft");
  const onopen = vi.fn<() => void>();
  const screen = await render(OpenRow, { label: "Süd öffnen", onopen, children });

  await screen.rerender({ label: "Nord öffnen" });
  expect(soft).not.toHaveBeenCalled();

  await page.getByRole("button", { name: "Nord öffnen" }).click();

  expect(onopen).toHaveBeenCalledOnce();
  expect(soft).toHaveBeenCalledOnce();
});

test("a link to another screen ticks once; one to the screen shown is silent", async () => {
  const selection = vi.spyOn(haptics, "selection");

  const screen = await render(NavLink, {
    href: "#/history",
    current: true,
    onclick: stay,
    children,
  });

  await page.getByRole("link", { name: "Süd" }).click();
  expect(selection).not.toHaveBeenCalled();

  await screen.rerender({ current: false });
  expect(selection).not.toHaveBeenCalled();

  await page.getByRole("link", { name: "Süd" }).click();
  expect(selection).toHaveBeenCalledOnce();
});
