// The profile catalogue as setup's picker shows it: by manufacturer, then family, filtered by what the admin types.
import type { Listing } from "../api/core.ts";
import { m } from "../paraglide/messages.js";
import { getLocale } from "../paraglide/runtime.js";
import { compact, found, queryWords, tokens } from "../search.ts";

/** A profile served, read only down to its variants. */
export type Served = Readonly<
  Omit<Listing, "variants"> & { variants: readonly Readonly<Listing["variants"][number]>[] }
>;

/** One thing a device can be added as: a profile, or one variant of a family (ADR 5). */
export interface Offer {
  readonly profile: string;
  /** None for a family's base, and for a profile that is no family. */
  readonly variant?: string;
  readonly name: string;
  readonly acRating: number | null | undefined;
  readonly official: boolean;
  /** Whether it is a family's base, which reads a device that is none of its variants. */
  readonly base: boolean;
}

/** What a profile offers: its base first, then its variants by rating. */
export type Family = readonly Offer[];

export interface Manufacturer {
  readonly name: string;
  readonly families: readonly Family[];
}

/** What a query word may begin with: each token, each name and id run together, and the rating as `15kw`. */
function words(
  manufacturer: string,
  { profile, variant, name, acRating }: Readonly<Offer>,
): string[] {
  const rating = acRating === undefined || acRating === null ? [] : [`${acRating / 1000}kw`];
  const names = [name, variant ?? "", profile];

  return [
    ...tokens(`${manufacturer} ${names.join(" ")}`),
    ...names.map((text) => compact(text)),
    ...rating,
  ];
}

/** A family with matches, and who makes it. */
interface Made {
  readonly maker: string;
  readonly family: Family;
}

const byRating = (a: Readonly<Offer>, b: Readonly<Offer>): number =>
  (a.acRating ?? 0) - (b.acRating ?? 0) || a.name.localeCompare(b.name);

/** Everything a device can be added as with `listing`. */
export function offers(listing: Served): Family {
  const { id: profile, name, acRating, official, variants } = listing;
  const base = { profile, name, acRating, official, base: variants.length > 0 };

  const own = variants.map((variant: Readonly<Listing["variants"][number]>): Offer => ({
    profile,
    variant: variant.id,
    name: variant.name,
    acRating: variant.acRating,
    official,
    base: false,
  }));

  return [base, ...own.toSorted(byRating)];
}

/**
 * What a device is read as, by name: its variant's, or its family's for the base and for a variant
 * the family does not list, such as a SunSpec model. The profile's id while it is not served.
 */
export function readAs(
  all: readonly Served[],
  { profile, variant }: { readonly profile: string; readonly variant?: string | null },
): string {
  const listing = all.find((served: Served) => served.id === profile);

  const own = listing?.variants.find(
    (v: Readonly<Listing["variants"][number]>) => v.id === variant,
  );

  return own?.name ?? listing?.name ?? profile;
}

/** Every offer matching `text`, grouped; families by id, manufacturers by name. */
export function catalogue(all: readonly Served[], text: string): Manufacturer[] {
  const wanted = queryWords(text);

  const families = all
    .toSorted((a: Served, b: Served) => a.id.localeCompare(b.id))
    .flatMap((listing: Served): Made[] => {
      const maker = listing.manufacturer;

      const family = offers(listing).filter((offer: Readonly<Offer>) =>
        found(words(maker, offer), wanted),
      );

      return family.length === 0 ? [] : [{ maker, family }];
    });

  const makers = Map.groupBy(families, ({ maker }: Made) => maker);

  return [...makers.keys()]
    .toSorted((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      families: (makers.get(name) ?? []).map(({ family }: Made) => family),
    }));
}

/** An offer's AC rating in kW, as shown beside its name; a base's is its family's largest. */
export function power({ acRating, base }: Readonly<Offer>): string | undefined {
  if (acRating === null || acRating === undefined) return undefined;

  const kw = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 });
  const rated = `${kw.format(acRating / 1000)} kW`;

  return base ? m.profile_up_to({ power: rated }) : rated;
}
