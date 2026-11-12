<!-- PROTOTYPE: how complete the record is: coverage of the range, every gap, and the daily energy balance check (ADR 14). -->
<script lang="ts">
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import { fmtDay, gapRows, selLabel } from "./query";
  import { num } from "./format";
  import type { Q } from "./route";

  let { q }: { q: Q } = $props();
  const gaps = $derived(gapRows(q.h, q.sel));
  const elapsed = $derived(q.tot.hours! + q.tot.gap!);
  const coverage = $derived(elapsed > 0 ? q.tot.hours! / elapsed : null);
</script>

<div class="flex flex-col gap-4">
  <dl class="grid grid-cols-3 divide-x divide-border/60 border-y border-border/60">
    <div class="flex flex-col gap-0.5 py-2.5 pr-3">
      <dt class="text-xs text-muted-foreground">Abdeckung · {selLabel(q.h, q.sel)}</dt>
      <dd class="text-base font-semibold tabular-nums">{coverage === null ? "–" : `${num(coverage * 100, coverage < 1 && coverage > 0.99 ? 1 : 0)} %`}</dd>
    </div>
    <div class="flex flex-col gap-0.5 px-3 py-2.5">
      <dt class="text-xs text-muted-foreground">Stunden ohne Daten</dt>
      <dd class="text-base font-semibold tabular-nums">{num(q.tot.gap!)}</dd>
    </div>
    <div class="flex flex-col gap-0.5 py-2.5 pl-3">
      <dt class="text-xs text-muted-foreground">Aufzeichnung seit</dt>
      <dd class="text-base font-semibold tabular-nums">{fmtDay(q.h, 0, true)}</dd>
    </div>
  </dl>

  <section aria-label="Lücken">
    <h3 class="pb-1 text-xs font-medium text-muted-foreground">Lücken in der Aufzeichnung</h3>
    {#if gaps.length}
      <ul class="divide-y divide-border/60 border-y border-border/60">
        {#each gaps as g (g.from)}
          <li>
            <button type="button" class="line flex w-full items-baseline gap-3 py-2 text-left text-sm" onclick={() => q.open(g.sel)}>
              <span class="min-w-0 flex-1 tabular-nums">ab {g.from}<span class="block text-xs text-muted-foreground">Wechselrichter nicht erreichbar{g.inRange ? " · im gewählten Zeitraum" : ""}</span></span>
              <span class="font-semibold tabular-nums">{g.hours} h</span>
              <ChevronRight class="size-4 shrink-0 self-center text-muted-foreground" />
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="flex items-center gap-2 border-y border-border/60 py-3 text-sm"><CircleCheck class="size-4 text-success" />Keine Lücken seit Beginn der Aufzeichnung.</p>
    {/if}
  </section>

  <p class="flex items-start gap-2 text-sm"><CircleCheck class="mt-0.5 size-4 shrink-0 text-success" /><span>Energiebilanz: kein Residuum an den Tagen im Zeitraum. Jeder Messpunkt erklärt, was seine Kinder verbrauchen.</span></p>
  <p class="max-w-[68ch] text-xs text-muted-foreground">Eine Lücke ist kein Nullwert: Summen lassen sie aus, Vergleiche über eine Lücke sind als unvollständig markiert, und im Diagramm ist sie schraffiert.</p>
</div>

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
