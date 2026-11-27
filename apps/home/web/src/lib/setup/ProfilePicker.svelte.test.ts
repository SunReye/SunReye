import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import "../../app.css";
import { unfaded } from "../scroll-fade.harness.ts";
import { tap } from "../builder/pointer.harness.ts";
import ProfilePicker from "./ProfilePicker.svelte";
import { closed } from "../motion/animations.harness.ts";
import { json } from "../api/core.harness.ts";

/** A phone; the sheet lands at once. */
beforeEach(async () => {
  await page.viewport(390, 800);
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
});

afterEach(async () => {
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

function listing(
  id: string,
  manufacturer: string,
  name: string,
  acRating: number | null,
  variants: readonly Readonly<{ id: string; name: string; acRating: number }>[] = [],
) {
  return { id, manufacturer, name, version: "1.0.0", official: true, acRating, variants };
}

const PROFILES = [
  listing("deye-sg01hp3", "Deye", "SG01HP3", 25_000, [
    { id: "12k", name: "SUN-12K-SG01HP3", acRating: 12_000 },
  ]),
  listing("deye-sg05lp3", "Deye", "SG05LP3", 20_000, [
    { id: "5k", name: "SUN-5K-SG05LP3-EU-SM2", acRating: 5000 },
    { id: "15k", name: "SUN-15K-SG05LP3-EU-SM2", acRating: 15_000 },
  ]),
  listing("shelly-pro-3em", "Shelly", "Pro 3EM", null),
];

function served(
  response: () => Response = () => json("Catalogue", { profiles: PROFILES }),
): Transport {
  return { base: "http://core.test/", fetch: () => Promise.resolve(response()) };
}

test("the admin finds their model by the family on its label and sees its rated power", async () => {
  const pick = vi.fn<(profile: string, variant?: string) => void>();

  const screen = await render(ProfilePicker, {
    core: connect(served()),
    value: "",
    label: "Profil für 192.168.1.30:502",
    onpick: pick,
  });

  await screen.getByRole("button", { name: "Profil für 192.168.1.30:502" }).click();
  await userEvent.fill(page.getByRole("searchbox", { name: "Profil suchen" }), "SG05LP3");

  const sheet = page.getByRole("dialog");

  await expect.element(sheet.getByRole("heading", { name: "Deye" })).toBeVisible();
  await expect
    .element(sheet.getByRole("button", { name: "SG05LP3 Ganze Baureihe, bis 20 kW" }))
    .toBeVisible();
  expect(sheet.getByRole("button", { name: /SG01HP3/u }).query()).toBeNull();
  // The list scrolls inside the sheet and fades its edges (ADR 21).
  expect(unfaded()).toEqual([]);
  await tap(sheet.getByRole("button", { name: "SUN-15K-SG05LP3-EU-SM2 15 kW" }));

  expect(pick).toHaveBeenCalledWith("deye-sg05lp3", "15k");
  await closed(page.getByRole("dialog"));
});

test("a device that is none of its family's variants is added as the family", async () => {
  const pick = vi.fn<(profile: string, variant?: string) => void>();

  const screen = await render(ProfilePicker, {
    core: connect(served()),
    value: "deye-sg05lp3",
    variant: "15k",
    label: "Profil",
    onpick: pick,
  });

  await tap(screen.getByRole("button", { name: "Profil" }));
  await userEvent.fill(page.getByRole("searchbox", { name: "Profil suchen" }), "SG05LP3");

  const sheet = page.getByRole("dialog");

  // The variant chosen before is the marked row, not its family.
  await expect
    .element(sheet.getByRole("button", { name: "SUN-15K-SG05LP3-EU-SM2 15 kW" }))
    .toHaveAttribute("aria-current", "true");
  await expect
    .element(sheet.getByRole("button", { name: "SG05LP3 Ganze Baureihe, bis 20 kW" }))
    .not.toHaveAttribute("aria-current");
  await tap(sheet.getByRole("button", { name: "SG05LP3 Ganze Baureihe, bis 20 kW" }));

  expect(pick).toHaveBeenCalledWith("deye-sg05lp3", undefined);
});

test("the chosen variant shows on the field by its name and power, a family by its own", async () => {
  const screen = await render(ProfilePicker, {
    core: connect(served()),
    value: "deye-sg05lp3",
    variant: "5k",
    label: "Profil",
    onpick: () => {},
  });

  await expect
    .element(screen.getByRole("button", { name: "Profil" }))
    .toHaveTextContent("SUN-5K-SG05LP3-EU-SM2 5 kW");

  await screen.rerender({ variant: undefined });

  await expect
    .element(screen.getByRole("button", { name: "Profil" }))
    .toHaveTextContent("SG05LP3 bis 20 kW");
});

test("a search nothing matches says so", async () => {
  const screen = await render(ProfilePicker, {
    core: connect(served()),
    value: "",
    label: "Profil",
    onpick: () => {},
  });

  await screen.getByRole("button", { name: "Profil" }).click();
  await userEvent.fill(page.getByRole("searchbox", { name: "Profil suchen" }), "fronius");

  await expect.element(page.getByText("Kein Profil passt zu „fronius“.")).toBeVisible();
});

test("a catalogue the core refuses says why", async () => {
  const screen = await render(ProfilePicker, {
    core: connect(
      served(() =>
        Response.json(
          { status: 401, code: "auth.required" },
          { status: 401, headers: { "content-type": "application/problem+json" } },
        ),
      ),
    ),
    value: "",
    label: "Profil",
    onpick: () => {},
  });

  await screen.getByRole("button", { name: "Profil" }).click();

  await expect.element(page.getByRole("alert")).toBeVisible();
});
