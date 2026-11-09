<script lang="ts">
  import type { Core } from "./api/core";
  import { m } from "./paraglide/messages.js";
  import PowerLines from "./PowerLines.svelte";
  import { getLocale } from "./paraglide/runtime.js";

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

  /** The SPA's locale, not the browser's; a new locale renders the screen anew. */
  const clock = new Intl.DateTimeFormat(getLocale(), { hour: "2-digit", minute: "2-digit" });

  /** Today so far of each named series. */
  async function measured(from: Core, id: number, wanted: string, start: Date): Promise<Row[]> {
    const loaded = await Promise.all(
      wanted.split("\n").map(async (name) => {
        const history = await from.history(id, name, start, new Date());

        return "points" in history
          ? history.points.map((p) => ({ time: new Date(p.start), power: p.mean, series: name }))
          : [];
      }),
    );

    return loaded.flat();
  }

  /** The whole day's forecast of each string wired to this inverter (ADR 17). */
  async function forecast(from: Core, id: number, start: Date): Promise<Row[]> {
    const layout = await from.layout();

    if (!("strings" in layout)) return [];

    const end = new Date(start);

    end.setDate(end.getDate() + 1);

    const loaded = await Promise.all(
      layout.strings
        .filter((s) => s.device === id)
        .map(async (s) => {
          const forecasts = await from.forecasts(id, `pv.string.power[${s.id}]`, start, end);
          const label = m.chart_forecast({ name: s.name });

          return "points" in forecasts
            ? forecasts.points.map((p) => ({
                time: new Date(p.target),
                power: p.value,
                series: label,
              }))
            : [];
        }),
    );

    return loaded.flat();
  }

  async function load(from: Core, id: number, wanted: string, signal: AbortSignal): Promise<void> {
    const start = new Date();

    start.setHours(0, 0, 0, 0);

    const loaded = await Promise.all([
      measured(from, id, wanted, start),
      forecast(from, id, start),
    ]);

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
  <PowerLines {rows} height={240} time={clock} />
</figure>
