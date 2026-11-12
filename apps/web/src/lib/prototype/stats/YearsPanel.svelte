<!-- PROTOTYPE: the year by month against the year before, every recorded year, and the records. Independent of the chosen range's length: it reads the range's year. -->
<script lang="ts">
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import BandChart, { type Band } from "./BandChart.svelte";
  import { dateOf } from "./history";
  import { autarky, change, records, selFor, step, sumRange, total, years, type Sel, type Sum } from "./query";
  import { delta, energy, money, num } from "./format";
  import type { Q } from "./route";

  let { q, height = 200 }: { q: Q; height?: number } = $props();

  const spec = $derived(
    q.metric === "money"
      ? { name: "Ersparnis", colour: "var(--e-solar)", of: (s: Sum) => s.saved!, fmt: money, unit: "€", max: undefined, points: false }
      : q.metric === "autarky"
        ? { name: "Autarkie", colour: "var(--e-battery)", of: (s: Sum) => (autarky(s) ?? 0) * 100, fmt: (v: number) => `${num(v)} %`, unit: "%", max: 100, points: true }
        : { name: "Produktion", colour: "var(--e-solar)", of: (s: Sum) => s.pv!, fmt: energy, unit: "kWh", max: undefined, points: false },
  );

  const year = $derived(selFor(q.h, "year", Math.min(q.h.today, Math.max(0, q.sel.to - 1))));
  const yearNo = $derived(dateOf(q.h.start, year.from).getFullYear());
  const months = $derived.by(() => {
    const out: { sel: Sel; sum: Sum; before: Sum | null }[] = [];
    for (let s = selFor(q.h, "month", year.from), b = selFor(q.h, "month", step(q.h, year, -1).from); s.from < year.to; s = step(q.h, s, 1), b = step(q.h, b, 1)) {
      const before = b.to > 0 ? sumRange(q.h, b.from * 24, b.to * 24) : null;
      out.push({ sel: s, sum: total(q.h, s, q.live), before: before && before.hours! > 0 ? before : null });
    }
    return out;
  });
  const mf = new Intl.DateTimeFormat("de-DE", { month: "short" });
  const mfl = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
  const bands = $derived(
    months.map((m, i): Band => {
      const date = dateOf(q.h.start, m.sel.from);
      const running = m.sel.from <= q.h.today && q.h.today < m.sel.to;
      return {
        key: `m${i}`,
        label: mf.format(date).replace(".", ""),
        tick: true,
        title: mfl.format(date),
        state: m.sel.to <= 0 ? "before" : m.sel.from > q.h.today ? "future" : running ? "live" : m.sum.hours === 0 ? "gap" : "data",
        partial: m.sum.gap! > 0 && m.sum.hours! > 0,
        up: [spec.of(m.sum)],
        down: [],
        mark: m.before ? spec.of(m.before) : null,
        drillable: m.sel.to > 0 && m.sel.from <= q.h.today,
      };
    }),
  );
  const rows = $derived(years(q.h, q.live));
  const hasBefore = $derived(months.some((m) => m.before));
  const best = $derived(records(q.h));
</script>

{#if q.fresh}
  <div class="flex min-h-[300px] flex-col justify-center gap-2 px-1">
    <h3 class="text-base font-semibold">Noch kein Jahr zum Vergleichen</h3>
    <p class="max-w-[52ch] text-sm text-muted-foreground">Monate erscheinen hier, sobald sie abgeschlossen sind. Der Vergleich mit dem Vorjahr beginnt nach zwölf Monaten Aufzeichnung.</p>
  </div>
{:else}
  <div class="flex flex-col gap-4">
    <BandChart
      {bands}
      up={[{ label: `${spec.name} ${yearNo}`, colour: spec.colour }]}
      markLabel={hasBefore ? String(yearNo - 1) : ""}
      summary={{ title: `${yearNo} nach Monaten`, up: [spec.of(total(q.h, year, q.live))], down: [], mark: null }}
      fmt={spec.fmt}
      unit={spec.unit}
      max={spec.max}
      {height}
      loading={q.loading}
      drillLabel="Monat öffnen"
      label="{spec.name} {yearNo} nach Monaten, mit dem Vorjahr als Marke"
      ondrill={(i) => q.open(months[i]!.sel)}
    />

    <div class="grid gap-x-6 gap-y-4 @[640px]:grid-cols-2">
      <section aria-label="Jahre">
        <h3 class="pb-1 text-xs font-medium text-muted-foreground">Jahre</h3>
        <ul class="divide-y divide-border/60 border-y border-border/60">
          {#each rows as r (r.year)}
            <li>
              <button type="button" class="line flex w-full items-baseline gap-3 py-2 text-left text-sm" onclick={() => q.open(r.sel)}>
                <span class="w-24 font-medium tabular-nums">{r.year}{#if r.running}<span class="font-normal text-muted-foreground">{" "}bis heute</span>{/if}</span>
                <span class="flex-1 text-right font-semibold tabular-nums">{spec.fmt(spec.of(r.sum))}</span>
                <span class="w-20 text-right text-xs text-muted-foreground tabular-nums">{r.before ? delta(spec.points ? (spec.of(r.sum) - spec.of(r.before)) / 100 : change(spec.of(r.sum), spec.of(r.before)), spec.points) : "erstes Jahr"}</span>
                <ChevronRight class="size-4 shrink-0 self-center text-muted-foreground" />
              </button>
            </li>
          {/each}
        </ul>
      </section>
      <section aria-label="Rekorde">
        <h3 class="pb-1 text-xs font-medium text-muted-foreground">Rekorde seit Beginn</h3>
        <ul class="divide-y divide-border/60 border-y border-border/60">
          {#each best as r (r.label)}
            <li>
              <button type="button" class="line flex w-full items-baseline gap-3 py-2 text-left text-sm" onclick={() => q.open(r.sel)}>
                <span class="min-w-0 flex-1">{r.label}<span class="block text-xs text-muted-foreground">{r.when}</span></span>
                <span class="font-semibold tabular-nums">{r.unit === "€" ? money(r.value) : energy(r.value)}</span>
                <ChevronRight class="size-4 shrink-0 self-center text-muted-foreground" />
              </button>
            </li>
          {/each}
        </ul>
      </section>
    </div>
  </div>
{/if}

<style>
  .line {
    outline: none;
  }
  .line:hover {
    background-color: color-mix(in oklab, var(--foreground) 4%, transparent);
  }
  .line:focus-visible {
    box-shadow: inset 0 0 0 2px var(--ring);
  }
</style>
