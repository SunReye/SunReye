// What a live view needs beside the stream: the layout's strings, which series are estimated and
// which have stored history.
import type { Core, PvString } from "../api/core.ts";

/** The layout's strings; none while it cannot be read. */
export async function layoutStrings(core: Readonly<Pick<Core, "layout">>): Promise<PvString[]> {
  const layout = await core.layout().catch(() => null);

  return layout !== null && "strings" in layout ? layout.strings : [];
}

/** By device id, its estimated series (ADR 17); none while capabilities cannot be read. */
export async function estimatedSeries(
  core: Readonly<Pick<Core, "capabilities">>,
): Promise<Record<string, readonly string[]>> {
  const caps = await core.capabilities().catch(() => null);

  return caps !== null && "devices" in caps
    ? Object.fromEntries(
        Object.keys(caps.devices).flatMap((d) => {
          const support = caps.devices[d];

          return support === undefined ? [] : [[d, support.estimated] as const];
        }),
      )
    : {};
}

/** The series with stored history, each `device/series` (ADR 22); none while the catalog cannot be read. */
export async function storedSeries(core: Readonly<Pick<Core, "series">>): Promise<string[]> {
  const found: string[] = [];

  try {
    const catalog = await core.series();

    if ("problem" in catalog) return [];

    for (const device of catalog)
      for (const stored of device.series) found.push(`${device.id}/${stored.series}`);
  } catch {
    // An unreachable core, or an answer that is no catalog: no reading links.
    return [];
  }

  return found;
}
