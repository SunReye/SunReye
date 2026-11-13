<!--
  History (ADR 11, 21): one question at a time. The range's answer up front (production, savings,
  autarky, the plant's state, each against a baseline), the chosen one over time below it, and the
  deeper analyses one tab away. Range, question and tab live in the hash route. Wide screens add
  the breakdown and what stands out beside the chart.
-->
<script lang="ts">
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import Staged from "../motion/Staged.svelte";
  import type { Go } from "../range/route.svelte.ts";
  import { Statistics, type StatisticsCore } from "./screen.svelte.ts";
  import StatsAside from "./StatsAside.svelte";
  import StatsCard from "./StatsCard.svelte";
  import StatsHeader from "./StatsHeader.svelte";
  import { summaryOf } from "./summary.ts";

  let { core, params, go }: { core: StatisticsCore; params: URLSearchParams; go: Go } = $props();

  const s = new Statistics(() => ({ core, params, go }));

  const got = $derived(s.data.current);

  const summary = $derived(
    got ? summaryOf(got, s.view, { rows: s.rows, learning: s.learning ? s.since : null }) : null,
  );
</script>

<main
  class="mx-auto flex w-full max-w-[1320px] flex-col gap-4 px-3 pt-4 pb-6 sm:px-4 lg:gap-5 lg:px-6 lg:pt-6"
>
  <StatsHeader {s} />

  <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
    <!-- The card and the aside each in a frame after the header's (ADR 21). -->
    <Staged>
      {#snippet skeleton()}<Skeleton class="h-[520px] rounded-lg" />{/snippet}
      <StatsCard {core} {s} {summary} />
    </Staged>

    {#if !s.data.failed}
      <Staged>
      <StatsAside
        label={s.route.label}
        rows={summary?.breakdown ?? []}
        notes={summary?.notes ?? []}
        loading={s.data.loading}
        fresh={s.fresh}
        since={s.since}
        today={s.today}
        payback={s.facts?.payback ?? null}
        tucked={s.view.metric === "money" && s.view.tab === "payback"}
        onnote={s.follow}
        onpayback={() => {
          s.open({ metric: "money", tab: "payback" });
        }}
      />
      </Staged>
    {/if}
  </div>
</main>
