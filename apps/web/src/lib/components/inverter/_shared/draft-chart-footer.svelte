<script lang="ts">
	// What a draft overlay says about itself, under the plot: that it is not
	// saved, and the two ways out of it.
	//
	// The sentence is the contract. Everything else on this page persists — the
	// custom charts, the visibility prefs, the statistics layout — so a chart
	// that will silently vanish has to say so where it is looked at, not in a
	// tooltip on a button.
	//
	// "Save as chart" hands the metric list to the editor that already exists,
	// seeded, so the draft is named and saved through the one path that writes a
	// custom chart. Admin-only, because that write is.
	import FloppyDisk from 'phosphor-svelte/lib/FloppyDisk';
	import X from 'phosphor-svelte/lib/X';
	import { Button } from '$lib/components/ui/button';
	import * as m from '$lib/paraglide/messages';
	import { customCharts } from '$lib/inverter/custom-charts.svelte';
	import { useAppSession } from '$lib/session';

	let { metrics, onClear }: { metrics: string[]; onClear: () => void } = $props();

	const session = useAppSession();
	const canSave = $derived($session.data?.user.role === 'admin');

	const save = () => customCharts.seedEditor(metrics);
</script>

<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
	<p class="text-xs text-muted-foreground">{m.chart_draft_temporary()}</p>
	<div class="flex items-center gap-2">
		<Button variant="ghost" size="sm" onclick={onClear}>
			<X class="size-4" />
			{m.chart_draft_clear()}
		</Button>
		{#if canSave}
			<Button variant="outline" size="sm" onclick={save}>
				<FloppyDisk class="size-4" />
				{m.chart_draft_save()}
			</Button>
		{/if}
	</div>
</div>
