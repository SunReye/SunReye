<!-- A figure's analysis tabs (ADR 21): the overview chart, the hour-of-day heat grid and the
  string comparison, each where the figure has it. -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import * as Tabs from "#lib/components/ui/tabs/index.js";
  import { m } from "../paraglide/messages.js";
  import type { AnalyticsInput } from "./Analytics.svelte";
  import AnalyticsPane from "./AnalyticsPane.svelte";
  import type { Analytics } from "./sheets.ts";

  let {
    title,
    colour,
    analytics,
    input,
    overview,
  }: {
    title: string;
    /** The figure's energy token. */
    colour: string;
    analytics: Analytics;
    input: AnalyticsInput;
    /** What the overview tab shows in place of the figure's chart. */
    overview?: Snippet;
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

    if (next !== undefined) chosen = next;
  }
</script>

{#snippet pane(t: Tab)}
  {#if t === "overview" && overview}
    {@render overview()}
  {:else}
    <AnalyticsPane tab={t} {title} {colour} {analytics} {input} />
  {/if}
{/snippet}

<Tabs.Root bind:value={() => tab, choose}>
  {#if tabs.length > 1}
    <Tabs.List variant="segmented">
      {#each tabs as [t, text] (t)}
        <Tabs.Trigger value={t}>{text()}</Tabs.Trigger>
      {/each}
    </Tabs.List>
  {/if}
  {#each tabs as [t] (t)}
    <!-- A hidden tab's content mounts too: its pane, and the reads it makes, wait until shown. -->
    <Tabs.Content value={t} class="pt-2">
      {#if t === tab}
        {@render pane(t)}
      {/if}
    </Tabs.Content>
  {/each}
</Tabs.Root>
