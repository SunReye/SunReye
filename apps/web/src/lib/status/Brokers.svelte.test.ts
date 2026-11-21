/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
// The brokers' card appears once the connections answer, with the screen already shown (ADR 21).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import type { Connection } from "../api/core.ts";
import { turn } from "../api/settled.harness.ts";
import { finish, hold } from "../motion/animations.harness.ts";
import { playFrame, settle } from "../motion/clock.harness.ts";
import Brokers from "./Brokers.svelte";

beforeEach(hold);

afterEach(() => {
  vi.restoreAllMocks();
});

const BROKER: Connection = {
  id: 2,
  name: "hass",
  transport: "mqtt",
  host: "hass.lan",
  port: 1883,
  secrets: [],
  status: { connected: true },
};

/** The card's way in or out, held at its start. */
const moves = () =>
  [...document.querySelectorAll('[data-slot="card-presence"]')]
    .flatMap((el) => el.getAnimations())
    .filter((a) => Number(a.effect?.getComputedTiming().duration) > 0);

test("the brokers' card opens as the connections answer, and stays while they are read again", async () => {
  const first = Promise.withResolvers<readonly Connection[]>();
  const screen = await render(Brokers, { answer: first.promise });
  const card = screen.getByRole("region", { name: "MQTT-Broker" });

  expect(card.query()).toBeNull();

  // The screen is drawn before the core answers.
  playFrame();
  first.resolve([BROKER]);
  await settle(() => moves().length > 0);
  await finish();
  await expect.element(card).toBeVisible();

  // Read again, as the screen's refresh does: the card keeps what it last showed.
  const again = Promise.withResolvers<readonly Connection[]>();

  await screen.rerender({ answer: again.promise });

  expect(card.query()).not.toBeNull();
  expect(moves()).toEqual([]);

  // The core lost mid-read: the card stays as it last was.
  again.reject(new TypeError("Failed to fetch"));
  await turn();

  expect(card.query()).not.toBeNull();
});
