<script module lang="ts">
	// One TOU period on the 24-hour timeline: a button spanning the period's share of
	// the day, tinted by whether it grid-charges, with a fill whose height tracks the
	// battery target. Captions drop out as the block gets narrower.
	export type PeriodPiece = {
		leftPct: number;
		widthPct: number;
		/** Border/background classes for the period's kind. */
		blockClass: string;
		/** Target-fill classes for the period's kind. */
		fillClass: string;
		/** Fill height 0–100. */
		fillHeight: number;
		/** Grid charging is enabled for this period. */
		grid: boolean;
		label: string;
		showLabel: boolean;
		target: number;
		unit: string;
		showTarget: boolean;
		title: string;
	};
</script>

<script lang="ts">
	let {
		piece,
		selected,
		onSelect
	}: {
		piece: PeriodPiece;
		selected: boolean;
		onSelect: () => void;
	} = $props();

	const ringClass = $derived(
		selected ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''
	);
</script>

<button
	type="button"
	onclick={onSelect}
	title={piece.title}
	class="group absolute inset-y-0 flex flex-col justify-between overflow-hidden rounded-sm border p-1.5 text-left transition-colors {piece.blockClass} {ringClass}"
	style="left: {piece.leftPct}%; width: calc({piece.widthPct}% - 2px);"
>
	<!-- SOC target fill: bar height maps to the battery target for this period -->
	<div class="absolute inset-x-0 bottom-0 {piece.fillClass}" style="height: {piece.fillHeight}%"></div>

	<div class="relative flex items-center gap-1">
		{#if piece.grid}
			<!-- lightning bolt = grid charging enabled this period -->
			<svg
				viewBox="0 0 24 24"
				class="size-3 shrink-0 text-amber-600 dark:text-amber-400"
				fill="currentColor"
				aria-hidden="true"
			>
				<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
			</svg>
		{/if}
		{#if piece.showLabel}
			<span class="truncate text-[10px] font-medium text-muted-foreground">{piece.label}</span>
		{/if}
	</div>
	{#if piece.showTarget}
		<span class="relative text-xs font-semibold tabular-nums">{piece.target}{piece.unit}</span>
	{/if}
</button>
