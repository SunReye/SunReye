/// <reference types="bun" />
// Identical range reads at once, through `connect`: one request while it runs, none kept after.
import { expect, test } from "bun:test";
import { connect } from "./core.ts";

const FROM = new Date("2026-11-12T00:00:00Z");
const TO = new Date("2026-11-12T12:00:00Z");

const POINTS = { points: [] };

/** A core that holds each request until the test answers it, with every URL it was asked. */
function held() {
  const urls: string[] = [];
  const waiting: ((response: Response) => void)[] = [];

  const core = connect({
    base: "http://core.test/",
    fetch: (request) => {
      urls.push(request.url);

      const { promise, resolve } = Promise.withResolvers<Response>();

      waiting.push(resolve);

      return promise;
    },
  });

  const answer = () => {
    for (const resolve of waiting.splice(0)) resolve(Response.json(POINTS));
  };

  return { core, urls, answer };
}

test("identical range reads at once share one request, and each caller gets the answer", async () => {
  const { core, urls, answer } = held();

  const reads = Promise.all([
    core.statistics(1, "pv.power", "hour", FROM, TO),
    core.statistics(1, "pv.power", "hour", FROM, TO),
    core.history(1, "pv.power", FROM, TO),
    core.history(1, "pv.power", FROM, TO),
    core.forecasts(1, "pv.power", FROM, TO),
    core.forecasts(1, "pv.power", FROM, TO),
  ]);

  await Promise.resolve();
  answer();

  const answers: readonly object[] = await reads;

  expect(answers).toEqual([POINTS, POINTS, POINTS, POINTS, POINTS, POINTS]);
  expect(urls).toHaveLength(3);
});

test("a read of another series or range asks on its own", async () => {
  const { core, urls, answer } = held();

  const reads = Promise.all([
    core.statistics(1, "pv.power", "hour", FROM, TO),
    core.statistics(1, "load.power", "hour", FROM, TO),
    core.statistics(1, "pv.power", "day", FROM, TO),
    core.statistics(2, "pv.power", "hour", FROM, TO),
  ]);

  await Promise.resolve();
  answer();
  await reads;

  expect(urls).toHaveLength(4);
});

test("no answer is kept: the same read once the first has settled asks again", async () => {
  const { core, urls, answer } = held();

  const first = core.history(1, "pv.power", FROM, TO);

  await Promise.resolve();
  answer();
  await first;

  const second = core.history(1, "pv.power", FROM, TO);

  await Promise.resolve();
  answer();
  await second;

  expect(urls).toHaveLength(2);
});
