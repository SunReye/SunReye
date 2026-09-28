<script lang="ts">
	import { displayLimitSoc, type EvccLoadpoint } from '$lib/evcc/store.svelte';
	import { socColor } from '$lib/inverter/sign-colors';

	// State-of-charge meter for one loadpoint, mirroring the ratio meters on the
	// daily-energy tiles: the bar fills to the current SoC on the shared socColor
	// ramp, with a tick marking the configured charge limit. Rendered only when the
	// loadpoint reports a vehicle SoC.
	let { lp }: { lp: EvccLoadpoint } = $props();

	const soc = $derived(Math.round(lp.vehicleSoc ?? 0));
	// The limit is a %, with 0 meaning "no limit"; only mark it when it sits inside the bar.
	const limit = $derived(displayLimitSoc(lp));
	const showLimit = $derived(limit > 0 && limit < 100);
</script>

<span class="flex flex-col gap-1 border-t border-border/40 pt-2">
	<span class="flex items-baseline justify-between gap-2 text-xs">
		<span class="min-w-0 truncate text-muted-foreground">{lp.vehicleTitle ?? ''}</span>
		<span class="flex shrink-0 items-baseline gap-2 tabular-nums">
			<!-- The tile's second headline, and the only one people read from a
			     distance. It used to be 12 px in the ramp colour — `--sign-warn` is
			     2.2:1 on `--card` in the light theme, so a half-full car reported
			     its state in ink nobody could find. The bar below still carries the
			     ramp; the digits take the card's own foreground. -->
			<span class="soc-readout text-base font-semibold leading-none sm:text-lg">{soc}%</span>
			{#if lp.vehicleRange !== null}
				<span class="text-muted-foreground">{Math.round(lp.vehicleRange)} km</span>
			{/if}
		</span>
	</span>
	<span class="relative block h-1 overflow-hidden rounded-full bg-border/60">
		<span
			class="block h-full rounded-full"
			style={`width:${soc}%;background:${socColor(soc)};transition:width 700ms ease`}
		></span>
		{#if showLimit}
			<span class="absolute top-0 h-full w-px bg-foreground/60" style={`left:${limit}%`}></span>
		{/if}
	</span>
</span>
