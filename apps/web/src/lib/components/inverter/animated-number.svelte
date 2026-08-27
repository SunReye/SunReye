<script lang="ts">
	import { untrack } from 'svelte';
	import { Tween, prefersReducedMotion } from 'svelte/motion';
	import { linear } from 'svelte/easing';
	import { bus } from '$lib/ws/bus.svelte';
	import { readoutGlideMs } from './_shared/glide';
	import { createNumberDisplay, resolveDecimals } from './animated-number';

	let {
		value,
		unit = null,
		class: className = '',
		intervalMs,
		animate = true
	}: {
		value: number;
		/** Drives decimal precision via the per-unit config (e.g. `W` → no decimals). */
		unit?: string | null;
		class?: string;
		/**
		 * Whether this readout is on screen. False gives a 0ms glide: the Tween
		 * snaps to each sample and starts no rAF loop, so an off-screen readout
		 * still shows the correct latest value at no per-frame cost. /history
		 * renders 63 of these above its lazy-mount gate — see `readoutGlideMs`.
		 */
		animate?: boolean;
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
	// cadence and eased linearly — see `glideDurationMs` in `_shared/glide.ts` for
	// the overshoot, for why the drift stops under `prefers-reduced-motion`, and
	// for why the charts' cursor shares the same policy.
	const tween = new Tween(untrack(() => value));
	// The formatting memo is per readout, so two instances can't contaminate each
	// other. It also makes most frames free: no Intl call and no text-node write
	// while the rounded value hasn't moved.
	const readout = createNumberDisplay();

	$effect(() => {
		const v = value; // track live updates only
		// Read the cadence untracked so its per-sample EMA nudging doesn't retrigger
		// this effect on its own — a new `value` is what should drive a new glide.
		const cadence = untrack(() => intervalMs ?? bus.cadenceMs);
		// `animate` is read UNTRACKED for the same reason as the cadence, and it
		// matters more here: scrolling flips it on every card that enters or
		// leaves, and a tracked read would re-run this effect and issue a fresh
		// `tween.set` for the value the tween ALREADY holds — starting a ~1150ms
		// rAF loop to animate a number from itself to itself, on every card, on
		// every scroll. The next sample picks up the new policy, which is the
		// same "takes effect on the next sample" rule the cadence follows.
		// The motion preference IS read tracked, so toggling it takes effect on the
		// next sample rather than at the next mount.
		void tween.set(v, {
			duration: readoutGlideMs(cadence, prefersReducedMotion.current, untrack(() => animate)),
			easing: linear
		});
	});

	const decimals = $derived(resolveDecimals(unit, value));
	const display = $derived(readout.format(tween.current, decimals));
</script>

<span class={className}>{display}</span>
