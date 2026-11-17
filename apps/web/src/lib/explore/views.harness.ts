// The Explore tests' saved views (ADR 22): what the fake core keeps and how it answers, and where
// the tests find the chips.
import { page } from "vitest/browser";
import type { View } from "./saved.ts";

/** `views`: the saved views as the core keeps them. `most`: how many it keeps. */
export const kept = { views: new Array<View>(), most: 20 };

export function resetViews(): void {
  kept.views = [];
  kept.most = 20;
}

export const WEEK: View = {
  id: 1,
  name: "Woche im Haus",
  query: "range=week&s=4294967294%3Aload.power",
};

export const FOLD: View = {
  id: 2,
  name: "Ertrag je Tag",
  query: "mode=fold&range=month&s=1%3Apv.energy.total",
};

const refused = (status: number, code: string) => Response.json({ status, code }, { status });

/** A request's draft: its name and query; null for any other body. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's own type.
async function draftOf(request: Request): Promise<Omit<View, "id"> | null> {
  const body: unknown = await request.json();

  if (!(body instanceof Object) || !("name" in body) || !("query" in body)) return null;

  return { name: String(body.name), query: String(body.query) };
}

function written(id: number | null, draft: Omit<View, "id">): Response {
  if (kept.views.some((view: View) => view.name === draft.name && view.id !== id))
    return refused(409, "views.name");

  if (id !== null) {
    const view = { id, ...draft };

    kept.views = kept.views.map((was: View) => (was.id === id ? view : was));

    return Response.json(view);
  }

  if (kept.views.length >= kept.most) return refused(409, "views.full");

  const view = { id: Math.max(0, ...kept.views.map((v: View) => v.id)) + 1, ...draft };

  kept.views = [...kept.views, view];

  return Response.json(view, { status: 201 });
}

/** Whether a request is for the saved views' routes. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's own type.
export const forViews = (request: Request): boolean =>
  /\/views(?:\/\d+)?$/u.test(new URL(request.url).pathname);

/** The saved views' routes as the core answers them (ADR 9). */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's own type.
export async function answerViews(request: Request): Promise<Response> {
  const named = /\/(\d+)$/u.exec(new URL(request.url).pathname)?.[1];
  const id = named === undefined ? null : Number(named);

  if (request.method === "GET") return Response.json({ views: kept.views });

  if (request.method === "DELETE") {
    kept.views = kept.views.filter((view: View) => view.id !== id);

    return new Response(null, { status: 204 });
  }

  const draft = await draftOf(request);

  return draft ? written(id, draft) : refused(400, "request.body");
}

/** The saved views' chips. */
export const savedChips = () => page.getByRole("list", { name: "Gespeicherte Ansichten" });

/** The chosen series' chips. */
export const chosenChips = () => page.getByRole("list", { name: "Gewählte Reihen" });
