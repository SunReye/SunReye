<!-- The card: the four figures, the verdict, the tabs and the open tab, which a finger drags to the next range. -->
<script lang="ts">
  import { MediaQuery } from "svelte/reactivity";
  import RangeCard from "../range/RangeCard.svelte";
  import LoadFailed from "../components/load-failed.svelte";
  import CardIntro from "./CardIntro.svelte";
  import CardPane from "./CardPane.svelte";
  import { cardText } from "./card-text.ts";
  import FigureTabs from "./FigureTabs.svelte";
  import { m } from "../paraglide/messages.js";
  import type { Statistics, StatisticsCore, Summary } from "./screen.svelte.ts";

  let {
    core,
    s,
    summary,
  }: {
    core: StatisticsCore;
    s: Statistics;
    summary: Summary | null;
  } = $props();

  const got = $derived(s.data.current);
  const quiet = $derived(s.data.loading || s.data.failed);
  const text = $derived(cardText({ range: s.route.range, view: s.view, tabs: s.tabs }, got));

  const wide = new MediaQuery("(min-width: 1024px)");
  const height = $derived(wide.current ? 320 : 232);
</script>

{#snippet body()}
  <div class="flex flex-col gap-3">
    <CardIntro
      {text}
      {summary}
      plant={s.view.metric === "plant"}
      tab={s.view.tab}
      onchoose={s.choose}
    />

    <CardPane {core} {s} {height} />
  </div>
{/snippet}

<RangeCard class="min-w-0 self-start" children={s.data.failed ? undefined : body}>
  {#snippet top()}
    <FigureTabs
      figures={text.figures}
      plant={{
        weak: s.rows.filter((r) => r.flag === "weak").length,
        learning: s.learning,
        battery: s.facts?.battery ?? false,
      }}
      metric={s.view.metric}
      against={text.against}
      {quiet}
      onpick={s.pick}
    />

    {#if s.data.failed}
      <LoadFailed
        size="block"
        text={m.stats_error_title()}
        detail={m.stats_error_text()}
        onretry={s.data.retry}
      />
    {/if}
  {/snippet}
</RangeCard>
