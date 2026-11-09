import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type ImportStatus, type Transport } from "../api/core.ts";
import ImportPanel from "./ImportPanel.svelte";

const SLUG = "inverter-v3";

const ARCHIVE = { devices: [{ slug: SLUG, profile: "some-v3-profile" }] };

const DEVICE = {
  id: 3,
  name: "Wechselrichter",
  connection: 1,
  profile: "some-profile",
  unit: 1,
  writes: false,
};

const IDLE: ImportStatus = { state: "idle", done: 0, total: 0 };

const DONE: ImportStatus = {
  state: "done",
  done: 2,
  total: 2,
  report: { series: 2, points: 120, hours: 4, days: 3, unread: [`${SLUG}/daily`], unmapped: [] },
};

function problem(status: number, code: string): Response {
  return Response.json(
    { status, code },
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

/**
 * A test core with one archive under `/share`: the status reads from `statuses` in turn, the
 * last repeating; `start` answers the import's start.
 */
function testCore(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- generated types are mutable.
  statuses: readonly ImportStatus[],
  start: () => Response = () => Response.json({ ...IDLE, state: "running" }, { status: 202 }),
): Transport & { readonly sent: string[] } {
  const sent: string[] = [];
  let read = 0;

  return {
    base: "http://core.test/",
    sent,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;

      if (path === "/api/v1/import/files")
        return Response.json({ files: [{ path: "v3/export.tar.gz", ...ARCHIVE }] });

      if (path === "/api/v1/devices") return Response.json({ devices: [DEVICE] });

      if (request.method === "GET") {
        const status = statuses[Math.min(read, statuses.length - 1)];
        read += 1;

        return Response.json(status);
      }

      if (path === "/api/v1/import/upload") {
        sent.push(`${request.method} ${path} ${request.headers.get("content-type") ?? ""}`);

        return Response.json(ARCHIVE, { status: 201 });
      }

      sent.push(`${request.method} ${path} ${await request.text()}`);

      return start();
    },
  };
}

test("an archive under /share imports into the chosen device, its progress then its result shown", async () => {
  const running: ImportStatus = { state: "running", done: 1, total: 2 };
  const transport = testCore([IDLE, running, DONE]);

  const screen = await render(ImportPanel, { core: connect(transport) });

  await screen.getByRole("radio", { name: "v3/export.tar.gz" }).click();
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: SLUG }).element(),
    "Wechselrichter (3)",
  );
  await screen.getByRole("button", { name: "Importieren" }).click();

  await expect
    .element(screen.getByRole("progressbar", { name: "Importfortschritt" }))
    .toHaveAttribute("value", "1");
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Importiert: 2 Reihen, 120 Änderungspunkte, 4 Stunden, 3 Tage.");
  await expect.element(screen.getByText(`${SLUG}/daily`)).toBeVisible();
  expect(transport.sent).toEqual([
    `POST /api/v1/import {"devices":[{"slug":"${SLUG}","device":3}],"path":"v3/export.tar.gz"}`,
  ]);
});

test("an uploaded archive offers its devices, and one left unmapped is not sent", async () => {
  const transport = testCore([IDLE, DONE]);

  const screen = await render(ImportPanel, { core: connect(transport) });

  const input = screen.getByLabelText("Archiv hochladen (höchstens 1 GiB)");

  await expect.element(input).toBeInTheDocument();
  await userEvent.upload(
    input.element(),
    new File([new Uint8Array([0x1f, 0x8b])], "export.tar.gz"),
  );
  await expect.element(screen.getByRole("combobox", { name: SLUG })).toHaveValue("");
  await screen.getByRole("button", { name: "Importieren" }).click();

  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Importiert: 2 Reihen, 120 Änderungspunkte, 4 Stunden, 3 Tage.");
  expect(transport.sent).toEqual([
    "POST /api/v1/import/upload application/gzip",
    'POST /api/v1/import {"devices":[]}',
  ]);
});

test("a refused or failed import shows why", async () => {
  const failed: ImportStatus = { state: "failed", done: 0, total: 0, problem: "import.profile" };
  const busy = testCore([IDLE], () => problem(409, "import.busy"));
  const broken = testCore([failed]);

  const refused = await render(ImportPanel, { core: connect(busy) });

  await refused.getByRole("radio", { name: "v3/export.tar.gz" }).click();
  await refused.getByRole("button", { name: "Importieren" }).click();

  await expect
    .element(refused.getByRole("alert"))
    .toHaveTextContent("Es läuft bereits ein Import.");
  await refused.unmount();

  const shown = await render(ImportPanel, { core: connect(broken) });

  await expect
    .element(shown.getByRole("alert"))
    .toHaveTextContent("Dem Archiv fehlt das Profil eines zugeordneten SunReye-3-Geräts.");
});
