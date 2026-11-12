<!-- PROTOTYPE: how well the solar forecast held: measured production against what was forecast, and what is still expected. -->
<script lang="ts">
  import BandChart, { type Band } from "./BandChart.svelte";
  import { accuracy, grainOf, selLabel } from "./query";
  import { delta, energy, percent } from "./format";
  import type { Q } from "./route";

  let { q, height = 200 }: { q: Q; height?: number } = $props();
  const bands = $derived(
    q.bs.map((b): Band => ({
      key: b.key,
      label: b.label,
      tick: b.tick,
      title: b.title,
      state: b.state,
      partial: b.partial,
      up: [b.sum.pv!],
      down: [],
      mark: b.state === "data" && b.sum.fcx! > 0 ? b.sum.fcx! : null,
      ghost: (b.state === "future" || b.state === "live") && b.sum.fc! > 0 ? b.sum.fc! : null,
      drillable: b.drill !== null && b.state !== "future" && b.state !== "before",
    })),
  );
  const acc = $derived(accuracy(q.h, q.sel));
</script>

<div class="flex flex-col gap-4">
  <BandChart
    {bands}
    up={[{ label: "gemessen", colour: "var(--e-solar)" }]}
    markLabel="Prognose"
    ghostLabel="Prognose"
    via={q.via}
    summary={{ title: `Summe · ${selLabel(q.h, q.sel)}`, up: [q.tot.pv!], down: [], mark: q.tot.fcx! }}
    fmt={energy}
    unit="kWh"
    {height}
    loading={q.loading}
    drillLabel={grainOf(q.sel) === "day" ? "Tag öffnen" : "Öffnen"}
    label="Gemessene Produktion gegen die Prognose"
    ondrill={(i) => q.bs[i]!.drill && q.open(q.bs[i]!.drill!)}
  />
  <dl class="grid grid-cols-3 divide-x divide-border/60 border-y border-border/60">
    <div class="flex flex-col gap-0.5 py-2.5 pr-3">
      <dt class="text-xs text-muted-foreground">Ø Abweichung je Tag</dt>
      <dd class="text-base font-semibold tabular-nums">{q.loading ? "–" : percent(acc.error)}</dd>
    </div>
    <div class="flex flex-col gap-0.5 px-3 py-2.5">
      <dt class="text-xs text-muted-foreground">Ist zur Prognose</dt>
      <dd class="text-base font-semibold tabular-nums">{q.loading ? "–" : delta(acc.bias)}</dd>
    </div>
    <div class="flex flex-col gap-0.5 py-2.5 pl-3">
      <dt class="text-xs text-muted-foreground">Ganze Tage</dt>
      <dd class="text-base font-semibold tabular-nums">{q.loading ? "–" : acc.days}</dd>
    </div>
  </dl>
  <p class="max-w-[68ch] text-xs text-muted-foreground">
    Die Prognose rechnet das PV-Layout auf das vorhergesagte Wetter und wendet die gelernte Korrektur je MPPT-Eingang an. Ein Wolkenfehler der Wettervorhersage wird nicht gelernt.
    <button type="button" class="font-medium text-brand underline-offset-2 outline-none hover:underline focus-visible:underline" onclick={() => q.view("plant", "strings")}>Korrektur ansehen</button>
  </p>
</div>
