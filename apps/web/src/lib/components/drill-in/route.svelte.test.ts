import { beforeEach, expect, test, vi } from "vitest";
import { drillRoute, type Router } from "./route.ts";

/** Where the router was sent. */
const sent: [string, Readonly<{ replace: boolean; state: App.PageState }>][] = [];
const back = vi.spyOn(history, "back").mockImplementation(() => {});

beforeEach(() => {
  sent.length = 0;
  back.mockClear();
});

/** A router on the hash route `path`, in the given history state. */
function on(path: string, drilled?: boolean): Router {
  const { pathname, search } = new URL(path, "http://host");

  return {
    page: { url: { pathname, search }, state: drilled === undefined ? {} : { drilled } },
    goto: async (url, options) => {
      sent.push([url, options]);
      await Promise.resolve();
    },
  };
}

test("the open group is the hash route's `group`", () => {
  expect(drillRoute(on("/controls?group=battery")).open).toBe("battery");
  expect(drillRoute(on("/controls")).open).toBeNull();
});

test("opening a group pushes its hash route", () => {
  drillRoute(on("/controls")).navigate("battery");

  expect(sent).toEqual([
    ["#/controls?group=battery", { replace: false, state: { drilled: true } }],
  ]);
});

test("switching groups replaces the route, so back still leads to the root", () => {
  drillRoute(on("/controls?group=battery", true)).navigate("grid");

  expect(sent).toEqual([["#/controls?group=grid", { replace: true, state: { drilled: true } }]]);
});

test("going back after a drill-in is the browser's back", () => {
  drillRoute(on("/controls?group=battery", true)).navigate(null);

  expect(back).toHaveBeenCalledOnce();
  expect(sent).toEqual([]);
});

test("going back from a deep link stays in the app and lands on the root", () => {
  drillRoute(on("/controls?group=battery&x=1")).navigate(null);

  expect(back).not.toHaveBeenCalled();
  expect(sent).toEqual([["#/controls?x=1", { replace: true, state: {} }]]);
});

test("navigate works handed over as `onnavigate` on its own", () => {
  const { navigate } = drillRoute(on("/controls"));

  navigate("battery");

  expect(sent).toEqual([
    ["#/controls?group=battery", { replace: false, state: { drilled: true } }],
  ]);
});

test("a screen may name its own level, as the dashboard's `detail` sheet", () => {
  const detail = drillRoute(on("/?detail=battery"), "detail");

  expect(detail.open).toBe("battery");

  drillRoute(on("/"), "detail").navigate("grid");

  expect(sent).toEqual([["#/?detail=grid", { replace: false, state: { drilled: true } }]]);
});
