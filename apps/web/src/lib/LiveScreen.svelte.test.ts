import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "./api/core.ts";
import LiveScreen from "./LiveScreen.svelte";

const SNAPSHOT = '{"devices":{"1":{"pv.power":1950,"grid.power":-120,"battery.soc":64}}}';

/** A test core: one live snapshot, then a held stream; history answers with one point. */
function testCore(live: Response): Transport & { readonly asked: string[] } {
  const asked: string[] = [];

  return {
    base: "http://core.test/",
    asked,
    fetch: (request) => {
      const url = new URL(request.url);

      asked.push(url.pathname + url.search);

      if (url.pathname.endsWith("/history")) {
        return Promise.resolve(
          Response.json({
            tier: "bucket",
            width: 60,
            points: [{ start: "2026-11-09T08:00:00Z", end: "2026-11-09T08:01:00Z", mean: 900 }],
          }),
        );
      }

      return asked.length === 1 ? Promise.resolve(live) : Promise.withResolvers<Response>().promise;
    },
  };
}

test("the screen shows each live power in the locale's format and charts its day", async () => {
  const transport = testCore(
    new Response(`event: snapshot\ndata: ${SNAPSHOT}\n\n`, {
      headers: { "content-type": "text/event-stream" },
    }),
  );

  const screen = await render(LiveScreen, { core: connect(transport) });

  await expect.element(screen.getByText("1.950 W")).toBeVisible();
  await expect.element(screen.getByText("-120 W")).toBeVisible();
  await expect.element(screen.getByText("battery.soc")).not.toBeInTheDocument();
  await expect.element(screen.getByRole("figure")).toBeVisible();
  await expect
    .poll(() => transport.asked.filter((path) => path.includes("/history")).toSorted())
    .toEqual([
      expect.stringMatching(/^\/api\/v1\/devices\/1\/history\?series=grid\.power&from=/u),
      expect.stringMatching(/^\/api\/v1\/devices\/1\/history\?series=pv\.power&from=/u),
    ]);
});

test("a refused stream shows its problem in German", async () => {
  const transport = testCore(
    Response.json({ status: 401, code: "auth.required" }, { status: 401 }),
  );

  const screen = await render(LiveScreen, { core: connect(transport) });

  await expect.element(screen.getByRole("alert")).toHaveTextContent("Bitte melde dich an.");
});
