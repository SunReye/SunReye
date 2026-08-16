<script lang="ts">
	// The colour of one series in a custom chart.
	//
	// Swatches, not a colour wheel, for two reasons. The value is persisted and
	// comes back to be written into a `style` attribute and into SVG
	// fill/stroke, so it is a palette id and never an arbitrary CSS string —
	// that is enforced in the schema, and a free-form field would only be a way
	// to produce values the server rejects. And a chart's job is telling series
	// apart: the eight here are chosen for that, where a wheel mostly offers
	// ways to pick two colours nobody can distinguish.
	import Palette from 'phosphor-svelte/lib/Palette';
	import Check from 'phosphor-svelte/lib/Check';
	import * as Popover from '$lib/components/ui/popover';
	import * as m from '$lib/paraglide/messages';
	import { SERIES_COLORS, colorVar, type SeriesColor } from '$lib/inverter/chart-palette';
	import { TAP } from '$lib/layout/tokens';

	let {
		color,
		fallback,
		onPick
	}: {
		/** The pinned colour, or undefined while the series takes the palette. */
		color: SeriesColor | undefined;
		/** What the series is drawn in when nothing is pinned. */
		fallback: string;
		onPick: (color: SeriesColor | undefined) => void;
	} = $props();

	const swatch = $derived(color ? colorVar(color) : fallback);
</script>

<Popover.Root>
	<Popover.Trigger
		class="{TAP} shrink-0 rounded-full border border-border transition-transform hover:scale-110"
		title={m.chart_series_color()}
		style="background: {swatch}; width: 1rem; height: 1rem"
	>
		<span class="sr-only">{m.chart_series_color()}</span>
	</Popover.Trigger>
	<Popover.Content class="w-auto p-2">
		<div class="grid grid-cols-4 gap-1">
			{#each SERIES_COLORS as id (id)}
				<button
					type="button"
					class="flex size-9 items-center justify-center rounded-md border border-border/60 sm:size-8"
					style="background: {colorVar(id)}"
					title={id}
					onclick={() => onPick(id)}
				>
					{#if color === id}
						<!-- White reads on every entry in this palette; they are all
						     mid-lightness by design. -->
						<Check class="size-4 text-white" weight="bold" />
					{/if}
					<span class="sr-only">{id}</span>
				</button>
			{/each}
		</div>
		<!-- The way back to "whatever position this series happens to sit at",
		     which is not the same as picking the colour it currently shows. -->
		<button
			type="button"
			class="mt-2 w-full rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/50"
			onclick={() => onPick(undefined)}
		>
			{m.chart_series_color_auto()}
		</button>
	</Popover.Content>
</Popover.Root>
