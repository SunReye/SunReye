<!--
  A detail's days (ADR 21 "Details by drilling down", ADR 23 "Dashboard"): a tab each, today
  first, then the weekdays after it. A switch slides the days by their order.
-->
<script lang="ts" generics="T extends { readonly start: number }">
  import type { Snippet } from "svelte";
  import * as Tabs from "#lib/components/ui/tabs/index.js";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import { daySlide } from "./day-slide.ts";

  let {
    days,
    zone,
    label,
    class: className,
    day,
    below,
  }: {
    /** Today first; each starts at its plant midnight, ms since 1970. */
    days: readonly T[];
    zone: string;
    /** Names the section and its tabs. */
    label: string;
    class: string;
    /** The chosen day, which slides. */
    day: Snippet<[T]>;
    /** What follows the section for the chosen day, standing still. */
    below?: Snippet<[T]>;
  } = $props();

  const HOUR = 3_600_000;

  const weekday = $derived(new Intl.DateTimeFormat(getLocale(), { weekday: "long", timeZone: zone }));

  /** Each day's tab: today, then the weekdays after it. */
  const tabs = $derived(
    days.map((d, i) => ({
      id: String(d.start),
      start: d.start,
      // A day's middle is on its date in any zone.
      name: i === 0 ? m.dash_today() : weekday.format(d.start + 12 * HOUR),
      day: d,
    })),
  );

  let chosen = $state<string>();
  const tab = $derived(tabs.find((t) => t.id === chosen) ?? tabs[0]);

  // The day at mount is where the first slide starts from; the transitions follow every later one.
  // svelte-ignore state_referenced_locally
  const { enter, leave } = daySlide(tab?.start ?? 0);

  function choose(id: string): void {
    if (id === tab?.id) return;

    haptics.selection();
    chosen = id;
  }
</script>

{#if tab}
  <section class={className} aria-label={label}>
    <Tabs.Root bind:value={() => tab.id, choose}>
      <Tabs.List variant="line" class="-ml-1.5" aria-label={label}>
        {#each tabs as t (t.id)}
          <Tabs.Trigger value={t.id}>{t.name}</Tabs.Trigger>
        {/each}
      </Tabs.List>
      <!-- One panel and one grid cell, so nothing reflows: the leaving and the arriving day slide
        through it. -->
      <Tabs.Content value={tab.id} class="grid overflow-x-clip pt-3">
        {#key tab.id}
          <div
            class="col-start-1 row-start-1 min-w-0"
            data-day
            in:enter={tab.start}
            out:leave={tab.start}
          >
            {@render day(tab.day)}
          </div>
        {/key}
      </Tabs.Content>
    </Tabs.Root>
  </section>

  {@render below?.(tab.day)}
{/if}
