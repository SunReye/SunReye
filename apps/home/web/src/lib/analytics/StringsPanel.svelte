<!--
  The installer's view (ADR 17, 21). Strings compared by specific yield in the range and by
  measured over modelled, the chosen one with the correction its MPPT input learned per month and
  hour. A table, because strings are compared across the same attributes.
-->
<script lang="ts">
  import { Pressable } from "@sunreye/ui/pressable";
  import LoadFailed from "../components/load-failed.svelte";
  import ChartEntrance from "../chart-entrance/ChartEntrance.svelte";
  import { m } from "../paraglide/messages.js";
  import { kwh as energy, num } from "../range/format.ts";
  import type { RangeRoute } from "../range/route.svelte.ts";
  import HeatGrid from "./HeatGrid.svelte";
  import StringFlag from "./StringFlag.svelte";
  import {
    MONTHS,
    stringEnergy,
    stringFacts,
    type StringFacts,
    type Compared,
    type StringsCore,
  } from "./string-energy.ts";
  import { correctionGrid, stringRows, type StringRow } from "./strings.ts";

  let {
    core,
    route,
    strings,
    sid,
  }: {
    core: StringsCore;
    route: RangeRoute;
    strings: Compared;
    /** The string chosen first; else a weak one, else the first. */
    sid: number | null;
  } = $props();

  let kwh = $state.raw<ReadonlyMap<number, number>>(new Map());
  let picked = $state<number | null>(null);

  /** The module types and the corrections; undefined until read. */
  let facts = $state.raw<StringFacts>();

  /** Raised to read them again. */
  let again = $state(0);

  const [pmax, corrections] = $derived(
    facts?.failed === false ? facts.data : [new Map<number, number>(), []],
  );

  // What does not follow the range is read once.
  $effect(() => {
    void again;
    facts = undefined;
    void stringFacts(core).then((got) => (facts = got));
  });

  $effect(() => {
    const r: RangeRoute = route;
    const [range, place, all] = [r.range, r.place, strings];
    let live = true;

    // A failed read keeps the last figures: the range's own read says it failed.
    void stringEnergy(core, all, place, range).then(
      (next) => {
        if (live) kwh = next;

        return next;
      },
      () => null,
    );

    return () => {
      live = false;
    };
  });

  const rows = $derived(
    stringRows(strings, {
      pmax: (type) => pmax.get(type),
      kwh: (id) => kwh.get(id) ?? null,
      corrections,
    }),
  );

  const chosen = $derived(
    rows.find((r) => r.id === (picked ?? sid)) ?? rows.find((r) => r.flag === "weak") ?? rows[0],
  );

  const input = $derived(
    chosen && corrections.find((c) => c.device === chosen.device && c.input === chosen.input),
  );

  const grid = $derived(correctionGrid(input));
  const best = $derived(Math.max(...rows.map((r) => r.perKwp ?? 0), 0.001));

  const ratioText = (v: number | null) => (v === null ? "–" : `${num(v * 100)} %`);
  const delta = (v: number) => `${v > 0 ? "+" : "−"}${Math.abs(Math.round(v * 100))} %`;

  function note(r: StringRow): string {
    if (r.flag === "weak" && r.ratio !== null) return m.strings_weak({ delta: delta(r.ratio - 1) });

    if (r.flag === "face")
      return (r.skew > 0 ? m.strings_face_east : m.strings_face_west)({
        delta: delta(Math.abs(r.skew)),
      });

    return "";
  }

  // Two hues around a neutral middle: under the model, over the model. Steps of a fifth.
  const fill = (v: number) => {
    const d = Math.max(-1, Math.min(1, (v - 1) / 0.2));
    const step = Math.round(Math.abs(d) * 5) * 20;

    return `color-mix(in oklab, var(${d < 0 ? "--d-under" : "--d-over"}) ${step}%, color-mix(in oklab, var(--foreground) 9%, transparent))`;
  };

  const SCALE = [0.8, 0.84, 0.88, 0.92, 0.96, 1, 1.04, 1.08, 1.12, 1.16, 1.2];

  /** The table's columns, shared by its head and its rows. */
  const COLS =
    "grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-center gap-x-3 px-1 @[520px]:grid-cols-[minmax(0,1fr)_7rem_6.5rem] @[520px]:gap-x-5";
</script>

<div class="@container flex flex-col gap-4">
  {#if facts?.failed}
    <LoadFailed
      text={m.strings_error()}
      refused={facts.refused}
      onretry={() => {
        again++;
      }}
    />
  {:else}
    <!-- The yield bars grow as the yields first show (ADR 21 "Chart entrance"). -->
    <ChartEntrance build="grow" ready={rows.some((r) => r.perKwp !== null)}>
      <div role="table" aria-label={m.strings_table()} class="text-sm">
        <div
          role="row"
          class={[COLS, "border-b border-border/60 pb-1.5 text-xs text-muted-foreground"]}
        >
          <span role="columnheader">{m.strings_string()}</span>
          <span role="columnheader" class="text-right">{m.strings_yield()}</span>
          <span role="columnheader" class="text-right">{m.strings_ratio()}</span>
        </div>
        {#each rows as r, i (r.id)}
          <Pressable
            feedback
            role="row"
            aria-selected={r.id === chosen?.id}
            selected={r.id === chosen?.id}
            class={[COLS, "w-full border-b border-border/60 py-2 text-left"]}
            onclick={() => {
              picked = r.id;
            }}
          >
            <span role="cell" class="flex min-w-0 items-start gap-1.5">
              <StringFlag flag={r.flag} label />
              <span class="min-w-0">
                <span class="line-clamp-2 font-medium">{r.name}</span>
                <span class="block truncate text-xs text-muted-foreground tabular-nums"
                  >{num(r.kwp, 1)} kWp{r.kwh === null ? "" : ` · ${energy(r.kwh)}`}{r.estimated
                    ? ` · ${m.detail_estimated()}`
                    : ""}</span
                >
              </span>
            </span>
            <span role="cell" class="flex flex-col items-end gap-1">
              <span class="font-semibold tabular-nums"
                >{r.perKwp === null ? "–" : num(r.perKwp, r.perKwp < 100 ? 1 : 0)}</span
              >
              <span class="h-1 w-full max-w-24 bg-foreground/10"
                ><span
                  class="block h-full origin-left bg-solar"
                  style:width="{((r.perKwp ?? 0) / best) * 100}%"
                  style:--i={i / rows.length}
                  data-grow="x"
                ></span></span
              >
            </span>
            <span role="cell" class="text-right font-semibold tabular-nums"
              >{ratioText(r.ratio)}</span
            >
          </Pressable>
        {/each}
        <p class="pt-2 text-xs text-muted-foreground">{m.strings_foot({ range: route.label })}</p>
      </div>
    </ChartEntrance>

    {#if chosen}
      <section
        class="flex flex-col gap-2 border-t border-border/60 pt-3"
        aria-label={m.strings_grid_label()}
      >
        <h3 class="text-sm font-semibold">
          {m.strings_correction({ input: chosen.input })}
          <span class="font-normal text-muted-foreground">· {chosen.name}</span>
        </h3>
        {#if note(chosen)}
          <p class="flex max-w-[68ch] items-start gap-2 text-sm text-pretty">
            <StringFlag flag={chosen.flag} label={false} />
            {note(chosen)}
          </p>
        {/if}
        {#if !input || input.factors.length === 0}
          <p class="py-6 text-sm text-muted-foreground">{m.strings_fresh()}</p>
        {:else}
          <HeatGrid
            cols={MONTHS}
            cells={grid}
            colour={fill}
            describe={(v) =>
              v === null ? m.strings_cell_none() : m.strings_cell({ value: ratioText(v) })}
            idle={m.strings_grid_idle()}
            label={m.strings_grid_label()}
            blank
          />
          <div
            class="flex flex-wrap items-center gap-x-2 gap-y-1 pl-10 text-xs text-muted-foreground tabular-nums"
          >
            <span>80 %</span>
            <span class="flex h-2 w-40 gap-px"
              >{#each SCALE as v (v)}<span class="flex-1" style:background={fill(v)}
                ></span>{/each}</span
            >
            <span>{m.strings_scale({ value: "120 %" })}</span>
          </div>
        {/if}
      </section>
    {/if}
  {/if}
</div>
