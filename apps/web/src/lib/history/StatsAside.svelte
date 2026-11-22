<!-- Beside the chart: the breakdown, the peaks, what stands out, and payback or, in the first week, what fills in. -->
<script lang="ts">
  import type { Payback } from "../api/tariff.ts";
  import { Presence } from "#lib/components/ui/card/index.js";
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

<!-- A column, so a card that appears or leaves glides what stands below (ADR 21); in two columns it does so at once. -->
<aside class="flex flex-col gap-4 sm:max-lg:grid sm:max-lg:grid-cols-2 sm:max-lg:content-start">
  <BreakdownCard {label} rows={shown.breakdown} against={shown.against} {loading} />

  {#if shown.peaks.length > 0 && !loading}
    <Presence><PeaksCard {label} peaks={shown.peaks} onopen={onrange} /></Presence>
  {/if}

  {#if shown.notes.length > 0 && !loading}
    <Presence><NotesCard notes={shown.notes} {onnote} /></Presence>
  {/if}

  {#if fresh}
    <Presence><Filling {since} {today} /></Presence>
  {:else if payback}
    <Presence><PaybackCard {payback} {loading} {tucked} onopen={onpayback} /></Presence>
  {/if}
</aside>
