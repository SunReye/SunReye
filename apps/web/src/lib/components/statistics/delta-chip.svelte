<script lang="ts">
	import { formatDelta } from '$lib/statistics/compare';
	import * as m from '$lib/paraglide/messages';

	// Signed change against the reference window. Colour follows the tile's
	// goodDirection rather than the sign, so "grid import down 20%" reads green
	// and "earnings down 20%" reads red; the arrow always follows the sign, so
	// the direction is never carried by colour alone.
	let {
		delta,
		goodDirection
	}: {
		/** Signed fraction (0.12 = +12%); null when there is no usable reference. */
		delta: number | null;
		goodDirection: 'up' | 'down' | 'neutral';
	} = $props();

	const up = $derived((delta ?? 0) > 0);
	const pct = $derived(formatDelta(delta));

	// Rounding hides sub-percent moves; treat those as flat rather than
	// colouring a "0%" chip.
	const flat = $derived(delta === null || Math.round(delta * 100) === 0);
	const good = $derived(goodDirection === (up ? 'up' : 'down'));
	const tone = $derived(
		flat || goodDirection === 'neutral' ? '' : good ? 'text-emerald-500' : 'text-red-500'
	);
	const aria = $derived(
		delta === null
			? m.statistics_delta_none_aria()
			: m.statistics_delta_aria({ percent: Math.round(delta * 100) })
	);
</script>

<span class="text-xs font-medium tabular-nums text-muted-foreground {tone}" aria-label={aria}>
	{pct}
</span>
