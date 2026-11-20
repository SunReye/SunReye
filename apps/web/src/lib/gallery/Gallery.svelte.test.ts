import { toast } from "svelte-sonner";
import { afterEach, expect, test } from "vitest";
import { cdp } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Gallery from "./Gallery.svelte";

/** Every component folder of the kit, by name. */
const kit = Object.keys(import.meta.glob("../components/ui/*/index.ts")).map(
  (path) => path.split("/").at(-2) ?? "",
);

const root = document.documentElement;

afterEach(async () => {
  toast.dismiss();
  root.classList.remove("dark");
  root.style.removeProperty("--radius");
  delete root.dataset["lowPower"];
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
  await cdp().send("Emulation.setEmitTouchEventsForMouse", { enabled: false });
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
});

function shown(): Element[] {
  return [...document.querySelectorAll("[data-gallery] *")];
}

/** The alpha of a computed colour; 1 when the colour has none. */
function alpha(colour: string): number {
  return Number(/\/\s*([\d.]+)\)$/u.exec(colour)?.[1] ?? 1);
}

/** A computed height in px, of the element or of one of its pseudo-elements. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a DOM element is mutable.
function height(element: Element, pseudo?: string): number {
  return Number(getComputedStyle(element, pseudo).height.replace("px", ""));
}

test("the gallery shows every component of the kit", async () => {
  await render(Gallery);

  const demos = [...document.querySelectorAll<HTMLElement>("[data-gallery]")];
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a DOM element is mutable.
  const names = new Set(demos.map((demo) => demo.dataset["gallery"]));

  expect(kit.length).toBeGreaterThan(50);
  expect(kit.filter((name) => !names.has(name))).toEqual([]);
});

test("the gallery shows every primitive built on the kit", async () => {
  await render(Gallery);

  for (const name of [
    "page-title",
    "section",
    "glass-card",
    "eyebrow",
    "stat-strip",
    "problem-alert",
    "status-line",
    "form-field",
    "text-field",
    "select-field",
    "date-field",
    "combobox-field",
    "confirm-sheet",
    "load-failed",
  ]) {
    expect(document.querySelector(`[data-gallery="${name}"]`), name).not.toBeNull();
  }
});

/** Asks for the raised toast that matches. */
const raised = (selector: string) => () => document.querySelector(`[data-sonner-toast]${selector}`);

test("the gallery raises a toast of every type", async () => {
  const screen = await render(Gallery);
  const demo = screen.container.querySelector('[data-gallery="sonner"]')!;

  for (const button of demo.querySelectorAll("button")) button.click();

  for (const type of ["default", "success", "error", "info", "warning", "loading"])
    // oxlint-disable-next-line no-await-in-loop -- one expectation at a time.
    await expect.poll(raised(`[data-type=${type}]`), { message: type }).not.toBeNull();

  await expect.poll(raised(":has([data-button]:not([data-cancel]))")).not.toBeNull();
  await expect.poll(raised(":has([data-cancel])")).not.toBeNull();
});

test("every corner in the kit follows --radius, but an avatar's", async () => {
  await render(Gallery);

  // Transitions would report the corner mid-flight.
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  // With the token at zero, a corner that stays round is set by the component, not the token.
  root.style.setProperty("--radius", "0px");

  const round = shown()
    .filter((element) => getComputedStyle(element).borderTopLeftRadius !== "0px")
    .map((element) => element.closest<HTMLElement>("[data-gallery]")?.dataset["gallery"]);

  expect([...new Set(round)]).toEqual(["avatar"]);
});

test("the kit's glass turns opaque under the low-power switch, in light and dark", async () => {
  await render(Gallery);

  const glass = shown().filter((element) => getComputedStyle(element).backdropFilter !== "none");

  // The alerts, the menubar and the ambient card at least.
  expect(glass.length).toBeGreaterThanOrEqual(4);

  root.dataset["lowPower"] = "";

  for (const theme of ["light", "dark"]) {
    root.classList.toggle("dark", theme === "dark");

    for (const surface of glass) {
      const style = getComputedStyle(surface);

      expect(alpha(style.backgroundColor), `${theme} ${surface.className}`).toBe(1);
      expect(style.backdropFilter).toBe("none");
    }
  }
});

test("on touch, a control is a 44 px target", async () => {
  const screen = await render(Gallery);

  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await cdp().send("Emulation.setEmitTouchEventsForMouse", {
    enabled: true,
    configuration: "mobile",
  });

  expect(matchMedia("(pointer: coarse)").matches).toBe(true);

  const small = screen.getByRole("button", { name: "Small", exact: true }).element();

  // A button keeps its size; its hit area grows around it.
  expect(height(small)).toBe(32);
  expect(height(small, "::after")).toBe(44);

  expect(height(screen.getByRole("textbox", { name: "Host" }).element())).toBe(44);
  expect(height(screen.getByRole("combobox", { name: "Timezone" }).first().element())).toBe(44);

  for (const name of ["Off", "Unchecked"]) {
    const control = screen.getByRole(name === "Off" ? "switch" : "checkbox", { name }).element();

    expect(height(control, "::after"), name).toBeGreaterThanOrEqual(44);
  }
});
