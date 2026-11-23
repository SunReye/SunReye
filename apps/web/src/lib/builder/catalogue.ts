// The module catalogue as the builder offers it (ADR 17): by maker, then series, filtered by what the admin types.
import type { Datasheet, Sheet, Source } from "@sunreye/catalogue";
import { compact, found, queryWords, tokens } from "../search.ts";
import { summary } from "./datasheet.ts";

/** One power class, keyed by its sheet and name. */
export interface Entry {
  readonly key: string;
  readonly datasheet: Readonly<Datasheet>;
  /** Pmax and size, as the row shows them. */
  readonly summary: string;
}

/** A sheet's power classes that match the query. */
interface Shelf {
  readonly sheet: Sheet;
  readonly modules: readonly Entry[];
}

export interface Series {
  readonly name: string;
  /** The datasheets its power classes were copied from. */
  readonly sources: readonly Source[];
  readonly modules: readonly Entry[];
}

export interface Maker {
  readonly name: string;
  readonly series: readonly Series[];
}

/** What a query word may begin with: each token, the series and name run together, Pmax as `450w`. */
function words(sheet: Sheet, module: Readonly<Datasheet>): string[] {
  const { maker, series } = sheet;

  return [
    ...tokens(`${maker} ${series} ${module.name}`),
    compact(series),
    compact(module.name),
    `${module.pmax}w`,
  ];
}

const byPower = (a: Readonly<Entry>, b: Readonly<Entry>): number =>
  a.datasheet.pmax - b.datasheet.pmax || a.datasheet.name.localeCompare(b.datasheet.name);

/** Every power class matching `text`, grouped; makers and series in name order. */
export function shelves(sheets: readonly Sheet[], text: string): Maker[] {
  const wanted = queryWords(text);

  const shelved = sheets.flatMap((sheet: Sheet, s): Shelf[] => {
    const modules = sheet.modules
      .filter((module: Readonly<Datasheet>) => {
        return found(words(sheet, module), wanted);
      })
      .map((datasheet: Readonly<Datasheet>): Entry => ({
        key: `${s}:${datasheet.name}`,
        datasheet,
        summary: summary(datasheet),
      }));

    return modules.length === 0 ? [] : [{ sheet, modules }];
  });

  const makers = Map.groupBy(shelved, ({ sheet }: Shelf) => sheet.maker);

  return [...makers.keys()].toSorted().map((name): Maker => {
    const series = Map.groupBy(makers.get(name) ?? [], ({ sheet }: Shelf) => sheet.series);

    return {
      name,
      series: [...series.keys()].toSorted().map((title): Series => {
        const shelf = series.get(title) ?? [];

        return {
          name: title,
          sources: shelf.map(({ sheet }: Shelf) => sheet.source),
          modules: shelf.flatMap(({ modules }: Shelf) => modules).toSorted(byPower),
        };
      }),
    };
  });
}
