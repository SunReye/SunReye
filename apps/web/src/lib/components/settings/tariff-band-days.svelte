<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as m from '$lib/paraglide/messages';

	// Weekday toggles of one time-of-use band. `days` holds 1 (Mon) … 7 (Sun),
	// kept sorted so the saved order is stable.
	let { days = $bindable() }: { days: number[] } = $props();

	const WEEKDAYS = [
		{ n: 1, label: m.tariff_day_mon() },
		{ n: 2, label: m.tariff_day_tue() },
		{ n: 3, label: m.tariff_day_wed() },
		{ n: 4, label: m.tariff_day_thu() },
		{ n: 5, label: m.tariff_day_fri() },
		{ n: 6, label: m.tariff_day_sat() },
		{ n: 7, label: m.tariff_day_sun() }
	];

	const dayVariant = (n: number) => (days.includes(n) ? 'default' : 'outline');

	function toggleDay(n: number) {
		days = days.includes(n) ? days.filter((d) => d !== n) : [...days, n].sort();
	}
</script>

<div class="flex flex-wrap gap-1">
	{#each WEEKDAYS as d (d.n)}
		<Button variant={dayVariant(d.n)} size="sm" onclick={() => toggleDay(d.n)}>
			{d.label}
		</Button>
	{/each}
</div>
