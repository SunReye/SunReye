<!-- Beside the chart: the breakdown, the peaks, what stands out, and payback or, in the first week, what fills in. -->
<script lang="ts">
  import type { Payback } from "../api/tariff.ts";
  import BreakdownCard from "./BreakdownCard.svelte";
  import type { Row } from "./breakdown.ts";
  import Filling from "./Filling.svelte";
  import type { Note } from "./notes.ts";
  import NotesCard from "./NotesCard.svelte";
  import PaybackCard from "./PaybackCard.svelte";
  import type { Peak } from "./peaks.ts";
  import PeaksCard from "./PeaksCard.svelte";
  import type { Range } from "../range/range.ts";

  let {
    label,
    rows,
    against,
    peaks,
    notes,
    loading,
    fresh,
    since,
    today,
    payback,
    tucked,
    onnote,
    onrange,
    onpayback,
  }: {
    /** The range's label. */
    label: string;
    rows: readonly Row[];
    /** What the breakdown's changes are against. */
    against: string;
    peaks: readonly Peak[];
    notes: readonly Note[];
    loading: boolean;
    /** Recording began days ago: what fills in replaces payback. */
    fresh: boolean;
    since: number;
    today: number;
    payback: Payback | null;
    /** The payback tab says it itself: the card fades, its place stays. */
    tucked: boolean;
    onnote: (note: Note) => void;
    /** Opens a peak's day. */
    onrange: (range: Range) => void;
    onpayback: () => void;
  } = $props();
</script>

<aside class="grid content-start gap-4 sm:max-lg:grid-cols-2">
  <BreakdownCard {label} {rows} {against} {loading} />

  {#if peaks.length > 0 && !loading}
    <PeaksCard {label} {peaks} onopen={onrange} />
  {/if}

  {#if notes.length > 0 && !loading}
    <NotesCard {notes} {onnote} />
  {/if}

  {#if fresh}
    <Filling {since} {today} />
  {:else if payback}
    <PaybackCard {payback} {loading} {tucked} onopen={onpayback} />
  {/if}
</aside>
