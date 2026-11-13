import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import "../../app.css";
import ProfilePicker from "./ProfilePicker.svelte";

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

function listing(id: string, manufacturer: string, name: string, acRating: number | null) {
  return { id, manufacturer, name, version: "1.0.0", official: true, acRating };
}

const PROFILES = [
  listing("deye-sg01hp3", "Deye", "SG01HP3", 25_000),
  listing("deye-sg01hp3-12k", "Deye", "SUN-12K-SG01HP3", 12_000),
  listing("deye-sg05lp3", "Deye", "SG05LP3", 20_000),
  listing("deye-sun15k-sg05lp3", "Deye", "SUN-15K-SG05LP3-EU-SM2", 15_000),
  listing("deye-sun5k-sg05lp3", "Deye", "SUN-5K-SG05LP3-EU-SM2", 5000),
  listing("shelly-pro-3em", "Shelly", "Pro 3EM", null),
];

function served(response: () => Response = () => Response.json({ profiles: PROFILES })): Transport {
  return { base: "http://core.test/", fetch: () => Promise.resolve(response()) };
}

test("the admin finds their model by the family on its label and sees its rated power", async () => {
  const pick = vi.fn<(id: string) => void>();

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
  await sheet.getByRole("button", { name: "SUN-15K-SG05LP3-EU-SM2 15 kW" }).click();

  expect(pick).toHaveBeenCalledWith("deye-sun15k-sg05lp3");
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});

test("the chosen profile shows on the field by its name and power", async () => {
  const screen = await render(ProfilePicker, {
    core: connect(served()),
    value: "deye-sun5k-sg05lp3",
    label: "Profil",
    onpick: () => {},
  });

  await expect
    .element(screen.getByRole("button", { name: "Profil" }))
    .toHaveTextContent("SUN-5K-SG05LP3-EU-SM2 5 kW");
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
