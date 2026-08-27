<script lang="ts">
	// The two ways out of a draft overlay, under the plot: discard it, or save it
	// as a custom chart.
	//
	// Icon-only, and with no sentence beside them. The legend above already names
	// a second series on a card titled after one metric, which is the tell that
	// this is not the card's own chart; a line of prose repeating it was reading
	// as chrome on every drafted card. The labels travel with the icons —
	// `title` for a pointer, `sr-only` for the keyboard and screen-reader path —
	// or the controls leave both entirely.
	//
	// "Save as chart" hands the metric list to the editor that already exists,
	// seeded, so the draft is named and saved through the one path that writes a
	// custom chart. Admin-only, because that write is.
	import FloppyDisk from 'phosphor-svelte/lib/FloppyDisk';
	import X from 'phosphor-svelte/lib/X';
	import * as m from '$lib/paraglide/messages';
	import { customCharts } from '$lib/inverter/custom-charts.svelte';
	import { useAppSession } from '$lib/session';
	import { TAP } from '$lib/layout/tokens';

	let { metrics, onClear }: { metrics: string[]; onClear: () => void } = $props();

	const session = useAppSession();
	const canSave = $derived($session.data?.user.role === 'admin');

	const save = () => customCharts.seedEditor(metrics);
</script>

<!-- `gap-4`, not the cluster gap: these are bare 16px icons whose TAP expanders
     reach 14px past their own box on every side, so a tighter row would put two
     44px hit areas on top of each other. -->
<div class="flex items-center justify-end gap-4">
	<button
		type="button"
		class="{TAP} text-muted-foreground transition-colors hover:text-foreground"
		onclick={onClear}
		title={m.chart_draft_clear()}
	>
		<X class="size-4" />
		<span class="sr-only">{m.chart_draft_clear()}</span>
	</button>
	{#if canSave}
		<button
			type="button"
			class="{TAP} text-muted-foreground transition-colors hover:text-foreground"
			onclick={save}
			title={m.chart_draft_save()}
		>
			<FloppyDisk class="size-4" />
			<span class="sr-only">{m.chart_draft_save()}</span>
		</button>
	{/if}
</div>
