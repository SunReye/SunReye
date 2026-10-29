<script lang="ts">
	// Test-only host for `section.svelte`: a section takes snippets for its
	// header actions and body, and a full-screen card needs a plot frame with a
	// chart box inside it. Mounted by `section.svelte.test.ts`.
	import Section from './section.svelte';
	import PlotFrame from './plot-frame.svelte';
	import { CHART_BOX } from '$lib/layout/tokens';

	let {
		title,
		collapsible = false,
		fullscreen = false,
		withActions = false
	}: {
		title: string;
		collapsible?: boolean;
		fullscreen?: boolean;
		withActions?: boolean;
	} = $props();
</script>

{#snippet actions()}
	{#if withActions}
		<span>Connected</span>
		<button type="button">Add device</button>
	{/if}
{/snippet}

<Section {title} {collapsible} {fullscreen} {actions}>
	<p>Section body</p>
	<!-- A chart component's own wrapper, as most have (plot plus legend), so the
	     expansion has to grow every box between the body and the plot. -->
	<div class="flex flex-col gap-2">
		<div>
			<PlotFrame>
				<div data-slot="chart" data-testid="plot" class="{CHART_BOX} w-full"></div>
			</PlotFrame>
		</div>
		<p>Legend</p>
	</div>
</Section>
