<script lang="ts">
	import PencilSimple from 'phosphor-svelte/lib/PencilSimple';
	import Trash from 'phosphor-svelte/lib/Trash';
	import { Button } from '$lib/components/ui/button';
	import * as msg from '$lib/paraglide/messages';
	import Section from '$lib/components/layout/section.svelte';
	import OverlayChartView from '$lib/components/inverter/_shared/overlay-chart-view.svelte';
	import type { CustomChart } from '$lib/inverter/custom-chart';
	import type { HistoryRange } from '$lib/inverter/ranges';

	// A saved custom chart: this card is the frame and the admin controls. Every
	// step from its metric keys to a drawn overlay is `OverlayChartView`, which a
	// DRAFT on a full-screened history card renders through as well — the only
	// difference between the two being where the key list came from.
	let {
		chart,
		range,
		isAdmin = false,
		onEdit,
		onDelete,
		onZoom,
		onResetZoom
	}: {
		chart: CustomChart;
		range: HistoryRange;
		isAdmin?: boolean;
		onEdit?: () => void;
		onDelete?: () => void;
		/** A window drag-selected on this chart; /history refetches every chart
		 *  on the page onto it, exactly as it does for a metric card. */
		onZoom?: (next: HistoryRange) => void;
		onResetZoom?: () => void;
	} = $props();
</script>

<!-- `nested`: a saved chart is one of a grid of cards inside the custom-chart
     section, which is itself inside the page shell. Three frames and three pads
     cost a quarter of a 390px screen; the card's own frame returns at sm. -->
<Section title={chart.name} nested fullscreen>
	{#snippet actions()}
		<!-- Title, edit and delete were one row spread by `justify-between`; the
		     two icon buttons are the section's right-hand cluster now. They are
		     icon-only, so the labels travel with them or they leave the keyboard
		     and screen-reader path entirely. -->
		{#if isAdmin}
			<div class="flex items-center gap-1">
				<Button variant="ghost" size="icon" aria-label={msg.chart_edit_chart()} onclick={onEdit}>
					<PencilSimple class="size-4" />
				</Button>
				<Button variant="ghost" size="icon" aria-label={msg.chart_delete_chart()} onclick={onDelete}>
					<Trash class="size-4" />
				</Button>
			</div>
		{/if}
	{/snippet}

	<OverlayChartView
		metrics={chart.metrics}
		{range}
		{onZoom}
		{onResetZoom}
		zoomed={range.id === 'zoom'}
	/>
</Section>
