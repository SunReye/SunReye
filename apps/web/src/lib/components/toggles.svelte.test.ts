import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { HAPTICS, haptics } from "@sunreye/ui/haptics";
import ToggleRow from "../settings/ToggleRow.svelte";
import { Checkbox } from "@sunreye/ui/checkbox";
import { Switch } from "./ui/switch/index.js";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem(HAPTICS);
});

interface Probe {
  readonly "aria-label": string;
  readonly checked: boolean;
  readonly onCheckedChange?: (checked: boolean) => void;
}

const KINDS = [
  ["switch", (props: Probe) => render(Switch, { ...props })],
  ["checkbox", (props: Probe) => render(Checkbox, { ...props })],
] as const;

test.each(KINDS)("a %s ticks once when the user flips it", async (role, mount) => {
  const selection = vi.spyOn(haptics, "selection");
  const onCheckedChange = vi.fn<(checked: boolean) => void>();

  await mount({ "aria-label": "Probe", checked: false, onCheckedChange });
  await userEvent.click(page.getByRole(role, { name: "Probe" }));

  expect(onCheckedChange).toHaveBeenCalledExactlyOnceWith(true);
  expect(selection).toHaveBeenCalledOnce();
});

test.each(KINDS)("a %s set by its owner is silent", async (role, mount) => {
  const selection = vi.spyOn(haptics, "selection");

  const screen = await mount({ "aria-label": "Probe", checked: false });

  await screen.rerender({ checked: true });
  await expect.element(page.getByRole(role, { name: "Probe" })).toBeChecked();

  expect(selection).not.toHaveBeenCalled();
});

test("the tick follows the change, so turning haptics on is felt", async () => {
  const stored: (string | null)[] = [];

  vi.spyOn(haptics, "selection").mockImplementation(() => {
    stored.push(localStorage.getItem(HAPTICS));
  });

  await render(ToggleRow, {
    label: "Haptik",
    checked: false,
    onchange: (on: boolean) => {
      localStorage.setItem(HAPTICS, on ? "on" : "off");
    },
  });
  await userEvent.click(page.getByRole("switch", { name: "Haptik" }));

  expect(stored).toEqual(["on"]);
});
