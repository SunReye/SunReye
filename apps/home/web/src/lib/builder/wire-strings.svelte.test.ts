import "../../app.css";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { StringDraft } from "../api/core.ts";
import Builder from "../../../../../../packages/builder/src/builder/Builder.svelte";
import {
  desk,
  DEVICES,
  drill,
  filledFace,
  hosted,
  house,
  inspector,
  MODULE,
  onCanvas,
  type Pointer,
  press,
  pv,
  settle,
  SIZES,
  testCore,
  undesk,
} from "./builder.harness.ts";
import { saveFrom } from "./moment.harness.ts";
import { type Transport } from "../api/core.ts";
import {
  addGrid,
  panels,
  type Draft,
} from "../../../../../../packages/builder/src/builder/modules.ts";
import { toThree } from "../../../../../../packages/builder/src/builder/scene.ts";

const OTHER = { ...MODULE, id: 8, name: "Other 300" };

function wired(name: string, moduleType: number): StringDraft {
  return {
    name,
    moduleType,
    device: 1,
    input: 1,
    modules: 0,
    optimized: 0,
    tilt: 0,
    azimuth: 0,
    loss: 2,
  };
}

/** The template house with both roof faces filled with unassigned modules. */
function filled(strings: readonly Readonly<StringDraft>[]): Draft {
  const { scene } = house();
  let gridded = addGrid(addGrid(scene, 0, 0, MODULE.id), 0, 1, MODULE.id);
  gridded = filledFace(filledFace(gridded, 0), 1);

  return { scene: gridded, strings };
}

/** Each module's centre on the page, in the order the canvas draws them. */
function centres(draft: Draft): [number, number][] {
  const onPage = onCanvas(draft.scene);
  const laid = pv.modules(draft.scene, SIZES).grids;

  return panels(draft.scene, laid).map(({ corners }) => {
    const sum = corners.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);

    return onPage(toThree([sum[0] / 4, sum[1] / 4, sum[2] / 4]));
  });
}

/** The modules a string's row summarises, as the strings group lists them. */
const made = (count: number) =>
  inspector().getByText(new RegExp(`^${count} Module, davon 0 mit Optimierer$`, "u"));

beforeEach(async () => {
  localStorage.removeItem("sunreye.builder.view");
  await desk();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await undesk();
});

async function opened(draft: Draft, transport: Readonly<Transport> = testCore()) {
  const draws = vi.spyOn(EffectComposer.prototype, "render");

  await render(Builder, {
    pv,
    ...hosted(transport),
    start: draft,
    moduleTypes: [MODULE, OTHER],
    devices: DEVICES,
  });

  await drill("Strings", draft.strings[0]?.name ?? "");
  await settle(() => draws.mock.calls.length > 0);
}

/** Three neighbouring modules of the face nearest the isometric camera. */
function three(draft: Draft): [number, number][] {
  const all = centres(draft);
  // The north face fills first: the south face's first row follows it.
  const south = draft.scene.grids?.[0]?.modules.length ?? 0;

  return all.slice(south, south + 3);
}

/** The bar that names the selection and wires it. */
const bar = () => page.getByRole("toolbar", { name: "Auswahl" });

const act = (name: string) => bar().getByRole("button", { name });

test.each<Pointer>(["mouse", "touch"])(
  "a %s drag across modules selects them; the bar wires them into the string, as one undo step",
  async (pointer) => {
    const draft = filled([wired("Süd", MODULE.id)]);

    await opened(draft);
    await press(pointer, three(draft));

    // Selecting wires nothing yet.
    await expect.element(bar().getByText("3 gewählt")).toBeVisible();
    await expect.element(made(0)).toBeVisible();

    await act("In Süd verdrahten").click();

    await expect.element(made(3)).toBeVisible();
    await expect.element(bar()).not.toBeInTheDocument();

    await inspector().getByRole("button", { name: "Rückgängig" }).click();

    await expect.element(made(0)).toBeVisible();
  },
);

test("a tap takes a selected module out again; the bar unwires a selection or drops it", async () => {
  const draft = filled([wired("Süd", MODULE.id)]);
  await opened(draft);

  const [first, second, third] = three(draft);

  if (first === undefined || second === undefined || third === undefined) {
    throw new Error("no modules");
  }

  await press("mouse", [first, second, third]);
  await press("mouse", [second]);
  await expect.element(bar().getByText("2 gewählt")).toBeVisible();

  await act("In Süd verdrahten").click();
  await expect.element(made(2)).toBeVisible();

  await press("mouse", [first]);
  await act("Lösen").click();
  await expect.element(made(1)).toBeVisible();

  await press("mouse", [third]);
  await act("Auswahl aufheben").click();
  await expect.element(bar()).not.toBeInTheDocument();
  await expect.element(made(1)).toBeVisible();
});

test("a selection of another module type than the string is refused in the bar, and stays", async () => {
  const draft = filled([wired("Ost", OTHER.id)]);

  await opened(draft);
  await press("mouse", three(draft).slice(0, 1));
  await act("In Ost verdrahten").click();

  await expect
    .element(page.getByRole("alert").filter({ hasText: "Ost hat einen anderen Modultyp" }))
    .toBeVisible();
  await expect.element(bar().getByText("1 gewählt")).toBeVisible();
  await expect.element(made(0)).toBeVisible();
});

test("with a string open the bar still offers a new string for the selection", async () => {
  const draft = filled([wired("Ost", OTHER.id)]);

  await opened(draft);
  await press("mouse", three(draft));
  await act("Neuer String").click();

  await expect.element(bar()).not.toBeInTheDocument();
  await drill("Strings");
  await expect
    .element(inspector().getByRole("button", { name: /^String 2.*3 Module/u }))
    .toBeVisible();
});

test("from the Strings group a selection is wired into a string of the menu, or a new one", async () => {
  const draft = filled([wired("Süd", MODULE.id)]);
  const draws = vi.spyOn(EffectComposer.prototype, "render");

  await render(Builder, {
    pv,
    ...hosted(testCore()),
    start: draft,
    moduleTypes: [MODULE, OTHER],
    devices: DEVICES,
  });
  await drill("Strings");
  await settle(() => draws.mock.calls.length > 0);

  await press("mouse", three(draft));
  await act("Verdrahten").click();
  await page.getByRole("menuitem", { name: "Neuer String" }).click();

  await expect
    .element(inspector().getByRole("button", { name: /^String 2.*3 Module/u }))
    .toBeVisible();
});

test("a selection wired in the order it was crossed saves that wiring order", async () => {
  const transport = testCore();
  const draft = filled([wired("Süd", MODULE.id)]);

  await opened(draft, transport);

  await press("mouse", three(draft).toReversed());
  await act("In Süd verdrahten").click();

  await expect.element(made(3)).toBeVisible();

  await saveFrom("2026-11-01");

  await expect.poll(() => transport.puts).toHaveLength(1);

  // The south face is the second grid, filled two rows of eight: its first row wired right to left.
  const south = Array.from({ length: 16 }, (_, i) => {
    const [row, column] = [Math.floor(i / 8), i % 8];
    const at = { landscape: false };

    return row === 0 && column < 3 ? { ...at, string: 0, order: 2 - column } : at;
  });

  expect(transport.puts[0]).toMatchObject({
    scene: { grids: [{ face: 0 }, { face: 1, modules: south }] },
  });
});
