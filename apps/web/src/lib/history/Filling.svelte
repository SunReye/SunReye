<!-- The first week: what is already there and when the rest fills in. -->
<script lang="ts">
  import * as Card from "#lib/components/ui/card/index.js";
  import Check from "@lucide/svelte/icons/check";
  import Circle from "@lucide/svelte/icons/circle";
  import { Button } from "#lib/components/ui/button/index.js";
  import { m } from "../paraglide/messages.js";
  import { shortDay } from "../range/calendar.ts";

  let { since, today }: { since: number; today: number } = $props();

  const items = $derived.by(() => {
    const days = today - since;
    const on = (d: number, year = false) => shortDay(since + d, year);

    return [
      { done: true, text: m.stats_fill_days(), when: m.stats_fill_since({ date: on(0) }) },
      {
        done: days >= 3,
        text: m.stats_fill_correction(),
        when:
          days >= 3 ? m.stats_fill_learning({ date: on(0) }) : m.stats_fill_from({ date: on(3) }),
      },
      { done: days >= 7, text: m.stats_fill_week(), when: m.stats_fill_from({ date: on(7) }) },
      { done: false, text: m.stats_fill_battery(), when: m.stats_fill_battery_when() },
      {
        done: false,
        text: m.stats_fill_payback(),
        when: m.stats_fill_from({ date: on(90, true) }),
      },
      { done: false, text: m.stats_fill_year(), when: m.stats_fill_from({ date: on(365, true) }) },
    ];
  });
</script>

<Card.Root element="section" aria-label={m.stats_filling()} class="gap-0 py-0">
  <h2 class="px-4 pt-3 text-sm font-semibold">{m.stats_filling()}</h2>
  <p class="px-4 pt-1 pb-2 text-xs text-muted-foreground">
    {m.stats_filling_text({ date: shortDay(since, true) })}
  </p>
  <ul class="divide-y divide-border/60 border-t border-border/60">
    {#each items as f (f.text)}
      <li class="flex items-start gap-2.5 px-4 py-2 text-sm">
        {#if f.done}<Check class="mt-0.5 size-4 shrink-0 text-success" />{:else}<Circle
            class="mt-0.5 size-4 shrink-0 text-muted-foreground/60"
          />{/if}
        <span class={["flex-1", !f.done && "text-muted-foreground"]}
          >{f.text}<span class="block text-xs text-muted-foreground">{f.when}</span></span
        >
      </li>
    {/each}
  </ul>
  <div class="border-t border-border/60 p-3">
    <Button variant="outline" size="sm" class="w-full" href="#/settings?group=danger"
      >{m.stats_import()}</Button
    >
  </div>
</Card.Root>
