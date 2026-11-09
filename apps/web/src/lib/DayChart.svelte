<script lang="ts">
  import { LineChart } from "layerchart/canvas";
  import type { Core } from "./api/core";

  let { core, device, series }: { core: Core; device: number; series: readonly string[] } =
    $props();

  interface Row {
    readonly time: Date;
    readonly power: number;
    readonly series: string;
  }

  // A string, so a live update that names the same series does not reload the day.
  const names = $derived(series.join("\n"));

  let rows = $state.raw<readonly Row[]>([]);

  /** Today so far, from local midnight, of each named series. */
  async function load(from: Core, id: number, wanted: string, signal: AbortSignal): Promise<void> {
    const end = new Date();
    const start = new Date(end);

    start.setHours(0, 0, 0, 0);

    const loaded = await Promise.all(
      wanted.split("\n").map(async (name) => {
        const history = await from.history(id, name, start, end);

        return "points" in history
          ? history.points.map((p) => ({ time: new Date(p.start), power: p.mean, series: name }))
          : [];
      }),
    );

    if (!signal.aborted) rows = loaded.flat();
  }

  $effect(() => {
    const abort = new AbortController();

    void load(core, device, names, abort.signal);

    return () => {
      abort.abort();
    };
  });
</script>

<figure>
  <LineChart data={rows} x="time" y="power" c="series" height={240} legend />
</figure>
