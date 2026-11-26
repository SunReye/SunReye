/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  ContextPress,
  LONG_PRESS,
  type Asked,
} from "../../../../../../packages/builder/src/builder/context-press.ts";

let canvas: HTMLCanvasElement;
let asked: Asked[];
let unwatch: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;left:0;top:0;width:200px;height:100px";
  document.body.append(canvas);
  asked = [];
  unwatch = new ContextPress(canvas, () => (to) => {
    asked.push(to);
  }).dispose;
});

afterEach(() => {
  unwatch();
  canvas.remove();
  vi.useRealTimers();
});

function pointer(
  type: string,
  [clientX, clientY]: readonly [number, number],
  init: PointerEventInit = {},
): PointerEvent {
  const event = new PointerEvent(type, {
    clientX,
    clientY,
    pointerId: 1,
    pointerType: "mouse",
    bubbles: true,
    cancelable: true,
    ...init,
  });

  canvas.dispatchEvent(event);

  return event;
}

test("a right click asks for the menu where it was pressed, on the page and on the canvas", () => {
  pointer("pointerdown", [150, 25], { button: 2 });
  pointer("pointerup", [151, 25], { button: 2 });

  expect(asked).toEqual([{ client: [150, 25], ndc: [0.5, 0.5] }]);
});

test("a right drag orbits: no menu", () => {
  pointer("pointerdown", [100, 50], { button: 2 });
  pointer("pointermove", [130, 50], { button: 2 });
  pointer("pointerup", [130, 50], { button: 2 });

  expect(asked).toEqual([]);
});

test("a left click asks for nothing", () => {
  pointer("pointerdown", [100, 50], { button: 0 });
  pointer("pointerup", [100, 50], { button: 0 });

  expect(asked).toEqual([]);
});

test("the browser's own menu never opens over the canvas", () => {
  const menu = new MouseEvent("contextmenu", { cancelable: true, bubbles: true });

  canvas.dispatchEvent(menu);

  expect(menu.defaultPrevented).toBe(true);
});

test("a finger held still asks for the menu once its long press is up", () => {
  pointer("pointerdown", [50, 50], { pointerType: "touch", button: 0 });
  vi.advanceTimersByTime(LONG_PRESS - 1);
  expect(asked).toEqual([]);

  vi.advanceTimersByTime(1);
  pointer("pointerup", [50, 50], { pointerType: "touch", button: 0 });

  expect(asked).toEqual([{ client: [50, 50], ndc: [-0.5, 0] }]);
});

test("a finger that moves, lets go early or is joined by a second asks for nothing", () => {
  pointer("pointerdown", [50, 50], { pointerType: "touch" });
  pointer("pointermove", [70, 50], { pointerType: "touch" });
  vi.advanceTimersByTime(LONG_PRESS);
  pointer("pointerup", [70, 50], { pointerType: "touch" });

  pointer("pointerdown", [50, 50], { pointerType: "touch" });
  pointer("pointerup", [50, 50], { pointerType: "touch" });
  vi.advanceTimersByTime(LONG_PRESS);

  pointer("pointerdown", [50, 50], { pointerType: "touch" });
  pointer("pointerdown", [80, 50], { pointerType: "touch", pointerId: 2 });
  vi.advanceTimersByTime(LONG_PRESS);

  expect(asked).toEqual([]);
});

test("a listener that stops the press still lets the menu be asked for", () => {
  canvas.addEventListener("pointerdown", (event) => {
    event.stopImmediatePropagation();
  });

  pointer("pointerdown", [100, 50], { button: 2 });
  pointer("pointerup", [100, 50], { button: 2 });

  expect(asked).toHaveLength(1);
});
