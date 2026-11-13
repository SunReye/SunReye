<!--
  A figure's range analytics (ADR 21): the sheet's range control, then tabs that all read it: the
  overview chart, the hour-of-day heat grid and the string comparison, each where the figure has
  it. A figure without a series in history shows `fallback` instead.
-->
<script lang="ts" module>
  import type { Core, PvString } from "../api/core.ts";
  import type { RangeRoute } from "../range/route.svelte.ts";

  /** What the analytics read: the core, the sheet's range and the layout's strings. */
  export interface AnalyticsInput {
    readonly core: Readonly<Pick<Core, "history" | "forecasts" | "moduleTypes" | "corrections">>;
    readonly route: RangeRoute;
    readonly strings: readonly PvString[];
  }
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import * as Tabs from "#lib/components/ui/tabs/index.js";
  import { analyticsOf } from "../analytics/sources.ts";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import RangeControl from "../range/RangeControl.svelte";
  import AnalyticsPane from "./AnalyticsPane.svelte";

  let {
    id,
    title,
    colour,
    input,
    fallback,
  }: {
    id: string;
    title: string;
    /** The figure's energy token. */
    colour: string;
    input: AnalyticsInput;
    fallback: Snippet;
  } = $props();

  const analytics = $derived(analyticsOf(id, input.strings));

  const TABS = [
    ["overview", m.detail_tab_overview],
    ["heat", m.detail_tab_heat],
    ["compare", m.detail_tab_compare],
  ] as const;

  type Tab = (typeof TABS)[number][0];

  const tabs = $derived(
    TABS.filter(
      ([t]) =>
        t === "overview" ||
        (t === "heat" && analytics?.heat) ||
        (t === "compare" && analytics?.compare),
    ),
  );

  let chosen = $state<Tab>("overview");
  const tab = $derived(tabs.some(([t]) => t === chosen) ? chosen : "overview");

  function choose(v: string): void {
    const next = tabs.find(([t]) => t === v)?.[0];

    if (next === undefined || next === tab) return;

    haptics.selection();
    chosen = next;
  }
</script>

{#if analytics}
  <section
    class="flex flex-col gap-3 border-t border-border/60 px-5 pt-4 pb-4 sm:px-6"
    aria-label={m.detail_analytics()}
  >
    <RangeControl model={input.route} />
    <Tabs.Root bind:value={() => tab, choose}>
      {#if tabs.length > 1}
        <Tabs.List variant="line">
          {#each tabs as [t, text] (t)}
            <Tabs.Trigger value={t}>{text()}</Tabs.Trigger>
          {/each}
        </Tabs.List>
      {/if}
      {#each tabs as [t] (t)}
        <Tabs.Content value={t} class="pt-2">
          <AnalyticsPane tab={t} {id} {title} {colour} {analytics} {input} />
        </Tabs.Content>
      {/each}
    </Tabs.Root>
  </section>
{:else}
  {@render fallback()}
{/if}
