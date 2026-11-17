<!-- A figure's analysis tabs (ADR 21): the overview chart, the hour-of-day heat grid and the
  string comparison, each where the figure has it. -->
<script lang="ts">
  import * as Tabs from "#lib/components/ui/tabs/index.js";
  import type { Analytics } from "../analytics/sources.ts";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import type { AnalyticsInput } from "./Analytics.svelte";
  import AnalyticsPane from "./AnalyticsPane.svelte";

  let {
    id,
    title,
    colour,
    analytics,
    input,
  }: {
    id: string;
    title: string;
    /** The figure's energy token. */
    colour: string;
    analytics: Analytics;
    input: AnalyticsInput;
  } = $props();

  const TABS = [
    ["overview", m.detail_tab_overview],
    ["heat", m.detail_tab_heat],
    ["compare", m.detail_tab_compare],
  ] as const;

  type Tab = (typeof TABS)[number][0];

  const tabs = $derived(
    TABS.filter(
      ([t]) =>
        t === "overview" || (t === "heat" && analytics.heat) || (t === "compare" && analytics.compare),
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
