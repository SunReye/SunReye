// The profile catalogue as setup's picker shows it: by manufacturer, then family, filtered by what the admin types.
import type { Listing } from "../api/core.ts";
import { getLocale } from "../paraglide/runtime.js";
import { compact, found, queryWords, tokens } from "../search.ts";

/** A family: its own profile first, when one is served, then its models by rating. */
export type Family = readonly Readonly<Listing>[];

export interface Manufacturer {
  readonly name: string;
  readonly families: readonly Family[];
}

/** What a query word may begin with: each token, each field run together, and the rating as `15kw`. */
function words({ id, manufacturer, name, acRating }: Readonly<Listing>): string[] {
  const rating = acRating === undefined || acRating === null ? [] : [`${acRating / 1000}kw`];

  return [...tokens(`${manufacturer} ${name} ${id}`), compact(name), compact(id), ...rating];
}

function matches(listing: Readonly<Listing>, wanted: readonly string[]): boolean {
  return found(words(listing), wanted);
}

/**
 * The profile whose id tokens are the fewest that a subset of `listing`'s are: `deye-sg05lp3`
 * for `deye-sun15k-sg05lp3`, the listing itself when none is.
 */
function root(listing: Readonly<Listing>, all: readonly Readonly<Listing>[]): Readonly<Listing> {
  const own = new Set(tokens(listing.id));

  return all
    .filter((other) => tokens(other.id).every((t) => own.has(t)))
    .reduce((best, other) => (tokens(other.id).length < tokens(best.id).length ? other : best));
}

/** Whether `family` is a family profile: another served profile's id holds all its tokens. */
export function covers(family: Readonly<Listing>, all: readonly Readonly<Listing>[]): boolean {
  return all.some((other) => other !== family && root(other, all) === family);
}

const byId = (a: Readonly<Listing>, b: Readonly<Listing>): number => a.id.localeCompare(b.id);

const byRating = (a: Readonly<Listing>, b: Readonly<Listing>): number =>
  (a.acRating ?? 0) - (b.acRating ?? 0) || a.name.localeCompare(b.name);

/** Every served profile matching `text`, grouped; families and manufacturers in name order. */
export function catalogue(all: readonly Readonly<Listing>[], text: string): Manufacturer[] {
  const wanted = queryWords(text);

  const families = Map.groupBy(
    all.filter((listing) => matches(listing, wanted)),
    (listing) => root(listing, all),
  );

  const heads = [...families.keys()].toSorted(byId);

  const ordered = heads.map((head): Family => {
    const members = families.get(head) ?? [];
    const models = members.filter((m) => m !== head).toSorted(byRating);

    return members.includes(head) ? [head].concat(models) : models;
  });

  const makers = Map.groupBy(ordered, (family: Family) => family[0]?.manufacturer ?? "");

  return [...makers.keys()]
    .toSorted((a, b) => a.localeCompare(b))
    .map((name) => ({ name, families: makers.get(name) ?? [] }));
}

/** An AC rating in kW, as a row shows it beside the model's name. */
export function rated(watts: number | null | undefined): string | undefined {
  if (watts === null || watts === undefined) return undefined;

  const kw = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 });

  return `${kw.format(watts / 1000)} kW`;
}
