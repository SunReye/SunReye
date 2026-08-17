<script lang="ts">
	// A history card's header cluster: the live reading, and the control that
	// pulls other metrics onto this card's chart.
	//
	// It held an "add to chart" menu here too — put this metric on one of the
	// saved custom charts. That went: it answered a question ("which saved chart
	// should own this?") that you can only ask if you already know what the
	// chart is for, where drafting answers the one you actually have in front of
	// you ("what does this look like next to that?") and ends at the same saved
	// chart by way of the editor.
	//
	// Its own file because the card's template crossed the complexity gate once
	// a second control joined the readout in the section's `actions` snippet.
	import MetricReadout from './metric-readout.svelte';
	import MetricCompareMenu from './metric-compare-menu.svelte';

	let {
		metricKey,
		value,
		unit,
		animate = true,
		draft = $bindable([])
	}: {
		metricKey: string;
		value: number | undefined;
		unit: string;
		/** Whether this card is on screen. False makes the readout step instead of
		 *  glide, so an off-screen card runs no rAF loop — see `readoutGlideMs`. */
		animate?: boolean;
		/** Metrics drafted on top of this card's own. */
		draft?: string[];
	} = $props();
</script>

<!-- The live value was the right half of the card's own header row; it is the
     section's header cluster now. -->
<MetricReadout {value} {unit} {animate} />
<!-- Not admin-gated, unlike the menu it replaced: overlaying two metrics to
     look at them is a read. It only becomes a write if the reader then saves
     the draft, and that goes through the editor, which is gated where it was. -->
<MetricCompareMenu base={metricKey} bind:draft />
