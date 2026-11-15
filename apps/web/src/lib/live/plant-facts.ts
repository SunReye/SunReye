// What a live view needs beside the stream: the layout's strings and which series are estimated.
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
