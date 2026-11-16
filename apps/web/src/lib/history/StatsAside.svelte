<!-- Beside the chart: the breakdown, the peaks, what stands out, and payback or, in the first week, what fills in. -->
<script lang="ts">
  import type { Payback } from "../api/tariff.ts";
  import BreakdownCard from "./BreakdownCard.svelte";
  import Filling from "./Filling.svelte";
  import type { Note } from "./notes.ts";
  import NotesCard from "./NotesCard.svelte";
  import PaybackCard from "./PaybackCard.svelte";
  import PeaksCard from "./PeaksCard.svelte";
  import type { Range } from "../range/range.ts";
  import type { Summary } from "./summary.ts";

  const NOTHING: Pick<Summary, "breakdown" | "against" | "peaks" | "notes"> = {
    breakdown: [],
    against: "",
    peaks: [],
    notes: [],
  };

  let {
    label,
    summary,
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
    /** Null before the first range is read: the breakdown stands empty. */
    summary: Summary | null;
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

  const shown = $derived(summary ?? NOTHING);
</script>

<aside class="grid content-start gap-4 sm:max-lg:grid-cols-2">
  <BreakdownCard {label} rows={shown.breakdown} against={shown.against} {loading} />

  {#if shown.peaks.length > 0 && !loading}
    <PeaksCard {label} peaks={shown.peaks} onopen={onrange} />
  {/if}

  {#if shown.notes.length > 0 && !loading}
    <NotesCard notes={shown.notes} {onnote} />
  {/if}

  {#if fresh}
    <Filling {since} {today} />
  {:else if payback}
    <PaybackCard {payback} {loading} {tucked} onopen={onpayback} />
  {/if}
</aside>
