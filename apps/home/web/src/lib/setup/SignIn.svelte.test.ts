import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import { haptics } from "@sunreye/ui/haptics";
import SignIn from "./SignIn.svelte";

function problem(status: number, code: string): Response {
  return Response.json(
    { status, code },
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

/** A core whose admin password is `secret`. */
function testCore(): Transport & { readonly bodies: unknown[] } {
  const bodies: unknown[] = [];

  return {
    base: "http://core.test/",
    bodies,
    fetch: async (request) => {
      const body: unknown = await request.json();

      bodies.push(body);

      return body instanceof Object && "password" in body && body.password === "secret"
        ? new Response(null, { status: 204 })
        : problem(401, "auth.credentials");
    },
  };
}

test("a wrong password is refused with the core's reason, the right one signs the admin in", async () => {
  const transport = testCore();
  const signedIn = vi.fn<() => void>();
  const screen = await render(SignIn, { core: connect(transport), onsignedin: signedIn });

  await userEvent.fill(screen.getByLabelText("Passwort"), "guess");
  await screen.getByRole("button", { name: "Anmelden" }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent("Das Passwort ist falsch.");
  expect(signedIn).not.toHaveBeenCalled();

  await userEvent.fill(screen.getByLabelText("Passwort"), "secret");
  await screen.getByRole("button", { name: "Anmelden" }).click();

  await expect.poll(() => signedIn.mock.calls.length).toBe(1);
  expect(transport.bodies).toEqual([{ password: "guess" }, { password: "secret" }]);
});

test("a viewer signs in by name and password", async () => {
  const transport = testCore();
  const signedIn = vi.fn<() => void>();
  const screen = await render(SignIn, { core: connect(transport), onsignedin: signedIn });

  await screen.getByRole("radio", { name: "Betrachter" }).click();
  await userEvent.fill(screen.getByLabelText("Name"), "Oma");
  await userEvent.fill(screen.getByLabelText("Passwort"), "secret");
  await screen.getByRole("button", { name: "Anmelden" }).click();

  await expect.poll(() => signedIn.mock.calls.length).toBe(1);
  expect(transport.bodies).toEqual([{ name: "Oma", password: "secret" }]);
});

test("a failed sign-in plays the error haptic", async () => {
  const error = vi.spyOn(haptics, "error");
  const screen = await render(SignIn, { core: connect(testCore()), onsignedin: () => {} });

  await userEvent.fill(screen.getByLabelText("Passwort"), "guess");
  await screen.getByRole("button", { name: "Anmelden" }).click();

  await expect.poll(() => error.mock.calls.length).toBe(1);
  error.mockRestore();
});
