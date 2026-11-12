<!-- The card: the four figures, the verdict, the tabs and the open tab. A finger on it but its chart steps the range. -->
<script lang="ts">
  import { MediaQuery } from "svelte/reactivity";
  import * as Card from "#lib/components/ui/card/index.js";
  import { haptics } from "../haptics.ts";
  import Pager from "../range/Pager.svelte";
  import CardIntro from "./CardIntro.svelte";
  import { cardText } from "./card-text.ts";
  import FigureTabs from "./FigureTabs.svelte";
  import LoadError from "./LoadError.svelte";
  import type { Statistics, StatisticsCore, Summary } from "./screen.svelte.ts";
  import StatsPane from "./StatsPane.svelte";

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

  let card = $state<HTMLElement | null>(null);
</script>

<Card.Root
  class="glass-ambient @container min-w-0 gap-0 self-start py-0"
  bind:ref={card}
>
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
    <LoadError onretry={s.data.retry} />
  {:else}
    <div class="flex flex-col gap-3 px-3 pt-4 pb-4 sm:px-5">
      <CardIntro
        {text}
        {summary}
        plant={s.view.metric === "plant"}
        tab={s.view.tab}
        onchoose={s.choose}
      />

      <div class="min-h-[348px] lg:min-h-[416px]">
        {#if s.pane}
          <Pager
            surface={card}
            id={s.paneId}
            data={s.pane}
            travel={s.travel}
            peek={s.peek}
            defer
            onstep={(dir) => {
              haptics.selection();
              s.drag(dir);
            }}
          >
            {#snippet children(d)}
              <StatsPane
                {core}
                got={d.got}
                view={d.view}
                route={s.route}
                facts={s.facts}
                fresh={s.fresh}
                loading={d.loading}
                {height}
                onview={s.open}
              />
            {/snippet}
          </Pager>
        {/if}
      </div>
    </div>
  {/if}
</Card.Root>
