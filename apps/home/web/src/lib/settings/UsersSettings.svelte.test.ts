import { toast } from "svelte-sonner";
import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect, type Transport } from "../api/core.ts";
import SettingsScreen from "./SettingsScreen.svelte";
import { problem } from "../api/core.harness.ts";
import { closed } from "../motion/animations.harness.ts";
import { json } from "../api/core.harness.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

interface Named {
  id: number;
  name: string;
  scope?: string;
}

/** One collection of the core, `/api/v1/<kind>`, changed as the admin asks. */
function collection(kind: "viewers" | "tokens", seed: readonly Readonly<Named>[]) {
  const items = [...seed];
  let next = 10;

  return {
    list: () => Response.json({ [kind]: items }),
    remove: (id: number) => {
      const index = items.findIndex((item) => item.id === id);

      if (index === -1) return problem(404, kind === "viewers" ? "viewer.none" : "token.none");

      items.splice(index, 1);

      return new Response(null, { status: 204 });
    },
    add: (name: string, scope: string) => {
      if (kind === "viewers" && items.some((item) => item.name === name)) {
        return problem(409, "viewer.name");
      }

      next += 1;

      if (kind === "viewers") {
        items.push({ id: next, name });

        return json("Viewer", { id: next, name }, { status: 201 });
      }

      items.push({ id: next, name, scope });

      return Response.json({ id: next, name, scope, token: "f00d".repeat(16) }, { status: 201 });
    },
  };
}

/** A core holding viewers and tokens as the admin changes them; a taken viewer name is refused. */
function accounts(
  viewers: readonly Readonly<Named>[],
  tokens: readonly Readonly<Named>[],
): Transport {
  const served = { viewers: collection("viewers", viewers), tokens: collection("tokens", tokens) };

  return {
    base: "http://core.test/",
    fetch: async (request) => {
      const [, , , kind, id] = new URL(request.url).pathname.split("/");
      const of = kind === "viewers" ? served.viewers : served.tokens;

      if (request.method === "GET") return of.list();

      if (request.method === "DELETE") return of.remove(Number(id));

      const body: unknown = await request.json();

      if (!(body instanceof Object) || !("name" in body)) return problem(400, "request.body");

      return of.add(String(body.name), "scope" in body ? String(body.scope) : "read");
    },
  };
}

function opened(transport: Transport) {
  return render(SettingsScreen, {
    core: connect(transport),
    admin: true,
    open: "access",
    onnavigate: () => null,
    level: null,
    onlevel: () => null,
  });
}

test("the admin sees every viewer and token with its scope", async () => {
  const screen = await opened(
    accounts([{ id: 1, name: "Oma" }], [{ id: 2, name: "evcc", scope: "admin" }]),
  );

  const viewers = screen.getByRole("region", { name: "Betrachter" });
  const tokens = screen.getByRole("region", { name: "Zugangstokens" });

  await expect.element(viewers.getByRole("list").getByText("Oma", { exact: true })).toBeVisible();
  await expect.element(tokens.getByRole("list").getByText("evcc", { exact: true })).toBeVisible();
  await expect.element(tokens.getByRole("list").getByText("Admin", { exact: true })).toBeVisible();
});

test("the tokens lead to the API reference they open", async () => {
  const screen = await opened(accounts([], []));
  const tokens = screen.getByRole("region", { name: "Zugangstokens" });

  await expect
    .element(tokens.getByRole("link", { name: "API-Referenz" }))
    .toHaveAttribute("href", "#/api");
});

test("an added viewer joins the list, and a taken name says why", async () => {
  const screen = await opened(accounts([{ id: 1, name: "Oma" }], []));
  const viewers = screen.getByRole("region", { name: "Betrachter" });

  // The form opens from the list's last row, in a sheet of its own.
  expect(page.getByRole("textbox", { name: "Name" }).query()).toBeNull();
  await userEvent.click(viewers.getByRole("button", { name: "Betrachter hinzufügen" }));
  await userEvent.fill(page.getByRole("textbox", { name: "Name" }), "Opa");
  await userEvent.fill(page.getByLabelText("Passwort"), "sonnenschein");
  await userEvent.click(page.getByRole("button", { name: "Betrachter hinzufügen" }).last());
  await closed(page.getByRole("dialog"));

  await expect.element(viewers.getByRole("list").getByText("Opa", { exact: true })).toBeVisible();

  await userEvent.click(viewers.getByRole("button", { name: "Betrachter hinzufügen" }));
  await userEvent.fill(page.getByRole("textbox", { name: "Name" }), "Oma");
  await userEvent.fill(page.getByLabelText("Passwort"), "sonnenschein");
  await userEvent.click(page.getByRole("button", { name: "Betrachter hinzufügen" }).last());

  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("Ein Betrachter mit diesem Namen existiert bereits.");
  // The refused draft stays for a fix.
  await expect.element(page.getByRole("textbox", { name: "Name" })).toHaveValue("Oma");
});

test("a viewer is removed only once the admin confirms", async () => {
  const screen = await opened(accounts([{ id: 1, name: "Oma" }], []));
  const viewers = screen.getByRole("region", { name: "Betrachter" });

  const success = vi.spyOn(toast, "success");
  const confirm = page.getByRole("dialog", { name: "Oma entfernen" });

  await userEvent.click(viewers.getByRole("button", { name: "Oma entfernen" }));
  await expect.element(confirm.getByText("Oma wird überall abgemeldet.")).toBeVisible();
  await expect.element(viewers.getByRole("list").getByText("Oma", { exact: true })).toBeVisible();

  await userEvent.click(confirm.getByRole("button", { name: "Entfernen", exact: true }));

  await expect
    .element(viewers.getByRole("list").getByText("Oma", { exact: true }))
    .not.toBeInTheDocument();
  await expect.element(confirm).not.toBeInTheDocument();
  expect(success).toHaveBeenCalledExactlyOnceWith("Entfernt.", {});
});

test("a new token is shown once with a copy button, then only its name stays", async () => {
  const copied = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const screen = await opened(accounts([], []));
  const tokens = screen.getByRole("region", { name: "Zugangstokens" });

  await userEvent.click(tokens.getByRole("button", { name: "Token erstellen" }));
  await userEvent.fill(page.getByRole("textbox", { name: "Name" }), "evcc");
  await userEvent.click(page.getByRole("radio", { name: "Admin" }));
  await userEvent.click(page.getByRole("button", { name: "Token erstellen" }).last());

  const shown = page.getByRole("status").filter({ hasText: "evcc" });

  await expect.element(shown.getByText(/Es wird nicht noch einmal angezeigt\./u)).toBeVisible();
  await expect.element(shown.getByText("f00d".repeat(16))).toBeVisible();

  await userEvent.click(shown.getByRole("button", { name: "Kopieren" }));
  expect(copied).toHaveBeenCalledWith("f00d".repeat(16));

  await userEvent.click(shown.getByRole("button", { name: "Fertig" }));

  await expect.element(page.getByText("f00d".repeat(16))).not.toBeInTheDocument();
  await expect.element(tokens.getByRole("list").getByText("evcc", { exact: true })).toBeVisible();
  await expect.element(tokens.getByRole("list").getByText("Admin", { exact: true })).toBeVisible();
  copied.mockRestore();
});

test("a token is revoked once the admin confirms", async () => {
  const screen = await opened(accounts([], [{ id: 2, name: "evcc", scope: "read" }]));
  const tokens = screen.getByRole("region", { name: "Zugangstokens" });

  const success = vi.spyOn(toast, "success");
  const confirm = page.getByRole("dialog", { name: "evcc widerrufen" });

  await userEvent.click(tokens.getByRole("button", { name: "evcc widerrufen" }));
  await expect
    .element(confirm.getByText("Was evcc nutzt, verliert sofort den Zugang."))
    .toBeVisible();
  await userEvent.click(confirm.getByRole("button", { name: "Widerrufen", exact: true }));

  await expect
    .element(tokens.getByRole("list").getByText("evcc", { exact: true }))
    .not.toBeInTheDocument();
  await expect.element(confirm).not.toBeInTheDocument();
  expect(success).toHaveBeenCalledExactlyOnceWith("Widerrufen.", {});
});
