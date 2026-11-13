import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect, type Transport } from "../api/core.ts";
import SettingsScreen from "./SettingsScreen.svelte";

/** A core that has not answered yet: every request stays open. */
const held: Transport = {
  base: "http://core.test/",
  fetch: () => Promise.withResolvers<Response>().promise,
};

test.each(["plant", "devices", "writes", "connections", "tariff", "logs", "danger"])(
  "the %s page stands in skeleton rows while the core answers",
  async (group) => {
    const screen = await render(SettingsScreen, {
      core: connect(held),
      admin: true,
      open: group,
      onnavigate: () => null,
    });

    await expect
      .element(screen.getByRole("status", { name: "Wird geladen …" }).first())
      .toBeVisible();
  },
);
