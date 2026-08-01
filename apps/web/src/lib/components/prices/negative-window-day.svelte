<script lang="ts">
	import type { NegativeWindow } from '$lib/prices/price-series';
	import * as m from '$lib/paraglide/messages';

	// One market-local day's worth of negative windows, as time chips.
	let { date, windows }: { date: string; windows: NegativeWindow[] } = $props();

	const ct = (v: number) =>
		`${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ct`;

	const dayLabel = $derived(
		new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
			weekday: 'short',
			day: '2-digit',
			month: '2-digit'
		})
	);
</script>

<div class="flex flex-col gap-1.5">
	<div class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{dayLabel}</div>
	<div class="flex flex-wrap gap-2">
		{#each windows as w (w.startMs)}
			<span class="flex items-baseline gap-2 border border-border px-2 py-1 text-xs tabular-nums">
				<span class="font-mono font-medium">{w.from}–{w.to}</span>
				<span class="text-muted-foreground">
					{m.prices_window_detail({ slots: w.slots, min: ct(w.minCtPerKwh) })}
				</span>
			</span>
		{/each}
	</div>
</div>
