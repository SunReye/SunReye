<script lang="ts">
	import { ctLabel, type NegativeWindow } from '$lib/prices/price-series';
	import { dayKeyDate, weekdayShortDate } from '$lib/format/date';
	import * as m from '$lib/paraglide/messages';

	// One market-local day's worth of negative windows, as time chips.
	let { date, windows }: { date: string; windows: NegativeWindow[] } = $props();

	const dayLabel = $derived(weekdayShortDate(dayKeyDate(date)));
</script>

<div class="flex flex-col gap-1.5">
	<div class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{dayLabel}</div>
	<div class="flex flex-wrap gap-2">
		{#each windows as w (w.startMs)}
			<span class="flex items-baseline gap-2 border border-border px-2 py-1 text-xs tabular-nums">
				<span class="font-mono font-medium">{w.from}–{w.to}</span>
				<span class="text-muted-foreground">
					{w.slots === 1
						? m.prices_window_detail_one({ min: ctLabel(w.minCtPerKwh) })
						: m.prices_window_detail_other({ slots: w.slots, min: ctLabel(w.minCtPerKwh) })}
				</span>
			</span>
		{/each}
	</div>
</div>
