<script lang="ts">
	import { untrack } from 'svelte';
	import { Tween } from 'svelte/motion';
	import { linear } from 'svelte/easing';
	import { configuredDecimals } from '$lib/inverter/format';
	import { bus } from '$lib/ws/bus.svelte';

	let {
		value,
		unit = null,
		class: className = '',
		intervalMs
	}: {
		value: number;
		/** Drives decimal precision via the per-unit config (e.g. `W` → no decimals). */
		unit?: string | null;
		class?: string;
		/**
		 * Sample cadence (ms) of the feed behind `value` — the glide is stretched
		 * across it so the number keeps drifting between samples. Defaults to the
		 * metrics cadence the bus measures, which is the one clock every polled
		 * reading shares; pass a source's own cadence when the value comes from a
		 * feed with its own rhythm (`evcc.cadenceMs` — EVCC publishes on MQTT
		 * traffic, not on our poll, and collapsing the two would be wrong).
		 */
		intervalMs?: number;
	} = $props();

	// Seed at the first value (untracked), then continuously interpolate toward
	// each new live value. To read as a continuous realtime feed rather than a
	// periodic step, every transition is stretched across the feed's actual sample
	// cadence and eased linearly. The small overshoot factor means the number is
	// still gently drifting toward its target when the next sample lands — instead
	// of arriving early and freezing until the feed ticks again, which is what made
	// a slow feed look like it stopped-then-jumped.
	const tween = new Tween(untrack(() => value));
	$effect(() => {
		const v = value; // track live updates only
		// Read the cadence untracked so its per-sample EMA nudging doesn't retrigger
		// this effect on its own — a new `value` is what should drive a new glide.
		const cadence = untrack(() => intervalMs ?? bus.cadenceMs);
		void tween.set(v, { duration: Math.max(300, cadence * 1.15), easing: linear });
	});

	// Decimal places locked to a single count so the digit shape stays fixed
	// mid-tween — min = max — otherwise an intermediate frame could sprout an extra
	// decimal and make the text jump. A unit with a configured precision (e.g. `W`
	// → 0) wins; otherwise fall back to the *target* value's own places, floored at
	// 1 (so `2` reads `2.0`) and capped at 2.
	const decimals = $derived.by(() => {
		const fixed = configuredDecimals(unit);
		if (fixed !== undefined) return fixed;
		if (Number.isInteger(value)) return 1;
		const dot = String(value).indexOf('.');
		const places = dot === -1 ? 0 : String(value).length - dot - 1;
		return Math.min(Math.max(places, 1), 2);
	});
	const display = $derived(
		tween.current.toLocaleString(undefined, {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals
		})
	);
</script>

<span class={className}>{display}</span>
