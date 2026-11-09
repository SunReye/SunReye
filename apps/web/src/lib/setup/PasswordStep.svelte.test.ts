import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import PasswordStep from "./PasswordStep.svelte";

/** A fresh core: it takes the password, then signs the admin in with it. */
function testCore(): Transport & { readonly calls: string[] } {
  const calls: string[] = [];

  return {
    base: "http://core.test/",
    calls,
    fetch: async (request) => {
      calls.push(`${new URL(request.url).pathname} ${await request.text()}`);

      return new Response(null, { status: 204 });
    },
  };
}

test("the admin repeats the password, which is set and signs them in", async () => {
  const transport = testCore();
  const done = vi.fn<() => void>();
  const screen = await render(PasswordStep, { core: connect(transport), ondone: done });

  await userEvent.fill(screen.getByLabelText("Passwort", { exact: true }), "solar sun");
  await userEvent.fill(screen.getByLabelText("Passwort wiederholen"), "solar son");
  await screen.getByRole("button", { name: "Passwort festlegen" }).click();

  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Die Passwörter stimmen nicht überein.");
  expect(transport.calls).toEqual([]);

  await userEvent.fill(screen.getByLabelText("Passwort wiederholen"), "solar sun");
  await screen.getByRole("button", { name: "Passwort festlegen" }).click();

  await expect.poll(() => done.mock.calls.length).toBe(1);
  expect(transport.calls).toEqual([
    '/api/v1/setup {"password":"solar sun"}',
    '/api/v1/login {"password":"solar sun"}',
  ]);
});
