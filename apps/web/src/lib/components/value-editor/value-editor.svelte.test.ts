import { afterEach, beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../../app.css";
import { HAPTICS } from "@sunreye/ui/haptics";
import { framesUntil, realTimers } from "../../motion/clock.harness.ts";
import { motion } from "../../motion/tier.svelte.ts";
import { editable, type Outcome } from "./editable.ts";
import ValueEditor from "./value-editor.svelte";
import { closed } from "../../motion/animations.harness.ts";

const CHARGE = editable({
  key: "battery.max_charge_current",
  name: "Max. Ladestrom",
  unit: "A",
  range: { min: 0, max: 240 },
  step: 1,
});

const MODE = editable({
  key: "work_mode",
  name: "Betriebsart",
  values: [0, 1, 2],
  labels: [
    { value: 0, text: "Verkauf zuerst" },
    { value: 1, text: "Nulleinspeisung" },
    { value: 2, text: "Eigenverbrauch" },
  ],
  step: 1,
});

const START = editable({
  key: "battery.time_of_use.1.start",
  name: "Zeitfenster 1 · Beginn",
  range: { min: 0, max: 1435 },
  step: 5,
  time: true,
});

let vibrate: ReturnType<typeof vi.fn<() => boolean>>;

beforeEach(async () => {
  // Springs land at once, so each test reads the settled value.
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  motion.lowPower = false;
  localStorage.removeItem(HAPTICS);
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

function editor(
  onapply: (value: number) => Promise<Outcome> = () => Promise.resolve({ kind: "confirmed" }),
  edit = CHARGE,
  current: number | null = 100,
) {
  // The row it opens beside, at the left edge, so the popover fits the viewport.
  const anchor = document.createElement("div");
  anchor.style.cssText = "position: fixed; left: 0; top: 0; width: 8px; height: 8px";
  document.body.append(anchor);

  // `anchor` is also a mount option, so the props go under `props`.
  return render(ValueEditor, {
    props: { key: "k", edit, current, anchor, open: true, onapply },
  });
}

test("screen readers see a spinbutton with the value and its unit", async () => {
  await editor();

  const wheel = page.getByRole("spinbutton", { name: "Max. Ladestrom" });

  await expect.element(wheel).toHaveAttribute("aria-valuenow", "100");
  await expect.element(wheel).toHaveAttribute("aria-valuetext", "100 A");
  await expect.element(wheel).toHaveAttribute("aria-valuemin", "0");
  await expect.element(wheel).toHaveAttribute("aria-valuemax", "240");
});

test("arrows move one step and Page Up and Down ten", async () => {
  await editor();

  const wheel = page.getByRole("spinbutton", { name: "Max. Ladestrom" });
  wheel.element().focus();

  await userEvent.keyboard("{ArrowUp}");
  await expect.element(wheel).toHaveAttribute("aria-valuenow", "101");
  await userEvent.keyboard("{PageDown}");
  await expect.element(wheel).toHaveAttribute("aria-valuenow", "91");
  await userEvent.keyboard("{PageUp}{ArrowDown}");
  await expect.element(wheel).toHaveAttribute("aria-valuenow", "100");
});

test("a mouse wheel notch moves one step", async () => {
  await editor();

  const wheel = page.getByRole("spinbutton", { name: "Max. Ladestrom" });
  wheel.element().dispatchEvent(new WheelEvent("wheel", { deltaY: 100, cancelable: true }));

  await expect.element(wheel).toHaveAttribute("aria-valuenow", "101");
});

test("tapping the large number lets you type the value", async () => {
  await editor();

  await userEvent.click(page.getByRole("button", { name: "100 A, tippen zum Eingeben" }));
  await userEvent.fill(page.getByRole("textbox", { name: "Max. Ladestrom eingeben" }), "80");
  await userEvent.keyboard("{Enter}");

  await expect
    .element(page.getByRole("spinbutton", { name: "Max. Ladestrom" }))
    .toHaveAttribute("aria-valuenow", "80");
});

test("a typed value outside the bounds lands on the nearest one it may take", async () => {
  await editor();

  await userEvent.click(page.getByRole("button", { name: "100 A, tippen zum Eingeben" }));
  await userEvent.fill(page.getByRole("textbox", { name: "Max. Ladestrom eingeben" }), "500");
  await userEvent.keyboard("{Enter}");

  await expect
    .element(page.getByRole("spinbutton", { name: "Max. Ladestrom" }))
    .toHaveAttribute("aria-valuenow", "240");
});

test("apply reads old → new and writes the new value", async () => {
  const onapply = vi.fn((_value: number) => Promise.resolve<Outcome>({ kind: "confirmed" }));
  await editor(onapply);

  const apply = page.getByRole("button", { name: "Keine Änderung" });

  await expect.element(apply).toBeDisabled();

  page.getByRole("spinbutton").element().focus();
  await userEvent.keyboard("{PageDown}{PageDown}");

  const change = page.getByRole("button", { name: /^Übernehmen/u });
  await expect.element(change).toHaveTextContent("Übernehmen 100 A 80 A");
  await userEvent.click(change);

  expect(onapply).toHaveBeenCalledExactlyOnceWith(80);
  await closed(page.getByRole("spinbutton"));
});

test("the editor shows pending until its caller reports the outcome", async () => {
  const write = Promise.withResolvers<Outcome>();

  await editor(() => write.promise);

  page.getByRole("spinbutton").element().focus();
  await userEvent.keyboard("{ArrowDown}");
  await userEvent.click(page.getByRole("button", { name: /^Übernehmen/u }));

  const pending = page.getByRole("button", { name: /Wird geschrieben/u });
  await expect.element(pending).toBeDisabled();

  write.resolve({ kind: "confirmed" });
  await closed(page.getByRole("spinbutton"));
});

test("a refusal stays open with its reason until the value changes", async () => {
  await editor(() => Promise.resolve({ kind: "refused", reason: "Mindestabstand." }));

  page.getByRole("spinbutton").element().focus();
  await userEvent.keyboard("{ArrowDown}");
  await userEvent.click(page.getByRole("button", { name: /^Übernehmen/u }));

  const alert = page.getByRole("alert");
  await expect.element(alert.getByText("Abgelehnt.")).toBeVisible();
  await expect.element(alert.getByText("Mindestabstand.", { exact: false })).toBeVisible();
  await expect
    .element(page.getByRole("link", { name: "Schreibprotokoll" }))
    .toHaveAttribute("href", "#/settings?group=logs");
  await expect.element(page.getByRole("button", { name: /^Übernehmen/u })).toBeDisabled();

  page.getByRole("spinbutton").element().focus();
  await userEvent.keyboard("{ArrowDown}");

  await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: /^Übernehmen/u })).toBeEnabled();
});

test("without a known value every value is a change", async () => {
  await editor(undefined, CHARGE, null);

  await expect
    .element(page.getByRole("button", { name: /^Übernehmen/u }))
    .toHaveTextContent("Übernehmen 0 A");
});

test("an enumerated setting picks from its list", async () => {
  const onapply = vi.fn((_value: number) => Promise.resolve<Outcome>({ kind: "confirmed" }));
  await editor(onapply, MODE, 0);

  const list = page.getByRole("radiogroup", { name: "Betriebsart" });
  await expect.element(list.getByRole("radio", { name: /Verkauf zuerst/u })).toBeChecked();

  await userEvent.click(list.getByRole("radio", { name: "Eigenverbrauch" }));
  await userEvent.click(page.getByRole("button", { name: /^Übernehmen/u }));

  expect(onapply).toHaveBeenCalledExactlyOnceWith(2);
});

test("opening plays nudge", async () => {
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
  vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
  localStorage.setItem(HAPTICS, "on");

  await editor();

  await expect.element(page.getByRole("spinbutton")).toBeVisible();
  expect(vibrate).toHaveBeenCalled();
});

test("a time shows an hour and a minute wheel at the step the profile allows", async () => {
  await editor(undefined, START, 22 * 60 + 30);

  const hour = page.getByRole("spinbutton", { name: "Stunde" });
  const minute = page.getByRole("spinbutton", { name: "Minute" });

  await expect.element(hour).toHaveAttribute("aria-valuetext", "22");
  await expect.element(minute).toHaveAttribute("aria-valuetext", "30");
  await expect.element(minute).toHaveAttribute("aria-valuemax", "55");
});

test("arrows move a time's hours and minutes and apply writes minutes since midnight", async () => {
  const onapply = vi.fn((_value: number) => Promise.resolve<Outcome>({ kind: "confirmed" }));
  await editor(onapply, START, 22 * 60 + 30);

  page.getByRole("spinbutton", { name: "Minute" }).element().focus();
  await userEvent.keyboard("{ArrowUp}");
  page.getByRole("spinbutton", { name: "Stunde" }).element().focus();
  await userEvent.keyboard("{ArrowDown}");

  const change = page.getByRole("button", { name: /^Übernehmen/u });
  await expect.element(change).toHaveTextContent("Übernehmen 22:30 21:35");
  await userEvent.click(change);

  expect(onapply).toHaveBeenCalledExactlyOnceWith(21 * 60 + 35);
});

test("a finger dragging the hour wheel up moves to a later hour", async () => {
  // The finger's speed and the wheel's landing on the test's clock.
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  onTestFinished(realTimers);
  await editor(undefined, START, 6 * 60);

  const hour = page.getByRole("spinbutton", { name: "Stunde" });
  const wheel = hour.element();

  // A synthetic pointer has no capture to take.
  wheel.setPointerCapture = () => {};

  const box = wheel.getBoundingClientRect();
  const clientX = box.left + box.width / 2;
  const y = box.top + box.height / 2;

  const touch = (type: string, clientY: number) =>
    wheel.dispatchEvent(
      new PointerEvent(type, {
        clientX,
        clientY,
        pointerType: "touch",
        pointerId: 7,
        isPrimary: true,
        bubbles: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
      }),
    );

  touch("pointerdown", y);

  for (const dy of [10, 30, 50, 70, 88]) touch("pointermove", y - dy);

  // The finger rests before it lifts, so the wheel lands where it was let go, without a fling.
  vi.advanceTimersByTime(100);
  touch("pointerup", y - 88);

  await framesUntil(() => wheel.getAttribute("aria-valuetext") === "08");
});

test("with low power on the wheel lands without a frame", async () => {
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
  motion.lowPower = true;
  await editor();

  const wheel = page.getByRole("spinbutton", { name: "Max. Ladestrom" });
  wheel.element().focus();
  // No frame ever comes: only a step that does not animate can land.
  vi.stubGlobal("requestAnimationFrame", () => 0);
  await userEvent.keyboard("{ArrowUp}");

  await expect.element(wheel).toHaveAttribute("aria-valuenow", "101");
});
