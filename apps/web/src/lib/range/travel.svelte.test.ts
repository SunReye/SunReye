import { expect, test } from "vitest";
import { rangeFor, rangeKey, step, type Calendar, type Range, type Via } from "./range.ts";
import { RangeTravel, type TravelRoute } from "./travel.svelte.ts";

const TODAY = 20_770;
const CAL: Calendar = { today: TODAY, hour: 12, last: TODAY };

interface Got {
  readonly range: Range;
  readonly figures: string;
}

const via = (dir: Via["dir"]): Via => ({ id: 0, kind: "morph", a: 0, b: 1, inward: true, dir });

/** What a card has read. */
interface Shown {
  got: Got | undefined;
}

/** A route on `range`, stepped as the hash route steps, and a card's figures for it. */
function card(range: Range = rangeFor("day", TODAY - 1)) {
  const route: TravelRoute & { range: Range; via: Via } = {
    range,
    via: via(0),
    place: { cal: CAL },
    step: (dir) => {
      route.range = step(CAL, route.range, dir);
      route.via = via(dir);
    },
  };

  const shown: Shown = { got: { range, figures: "read" } };

  const travel = new RangeTravel(() => ({
    route,
    got: shown.got,
    loading: false,
    pending: (got: Got, next: Range): Got => ({ range: next, figures: `${got.figures} → pending` }),
  }));

  return { route, shown, travel };
}

test("a finger's drag slides to the next range; an arrow's step keeps the pane", () => {
  const { route, travel } = card();

  travel.drag(1);
  expect(route.range).toEqual(rangeFor("day", TODAY));
  expect(travel.travel()).toEqual({ kind: "slide", dir: 1 });

  route.step(-1);
  expect(travel.travel()).toEqual({ kind: "keep", dir: -1 });
});

test("the range a drag reached draws loading until its figures come", () => {
  const { shown, travel } = card();
  const today = rangeFor("day", TODAY);

  travel.drag(1);
  expect(travel.id).toBe(rangeKey(today));
  expect(travel.pane).toEqual({ got: { range: today, figures: "read → pending" }, loading: true });

  shown.got = { range: today, figures: "today's" };
  expect(travel.pane).toEqual({ got: { range: today, figures: "today's" }, loading: false });
});

test("an arrow's step keeps the last figures while the next range loads", () => {
  const { route, shown, travel } = card();

  route.step(1);
  expect(travel.pane).toEqual({ got: shown.got, loading: false });
});

test("a drag uncovers the neighbour drawn loading, and nothing past the end of the record", () => {
  const { travel } = card(rangeFor("day", TODAY));
  const yesterday = rangeFor("day", TODAY - 1);

  expect(travel.peek(-1)).toEqual({
    id: rangeKey(yesterday),
    data: { got: { range: yesterday, figures: "read → pending" }, loading: true },
  });
  expect(travel.peek(1)).toBeNull();
});

test("nothing is uncovered before the first figures", () => {
  const { shown, travel } = card();

  shown.got = undefined;
  expect(travel.pane).toBeNull();
  expect(travel.peek(-1)).toBeNull();
});
