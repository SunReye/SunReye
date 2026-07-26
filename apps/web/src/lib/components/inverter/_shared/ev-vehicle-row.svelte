<script lang="ts">
	// The vehicle footer of an EV charger tile: the SoC meter when the vehicle
	// reports one, otherwise just its name so the row height stays consistent
	// across the strip. Nothing at all when there's no vehicle to speak of.
	import EvSocMeter from '$lib/components/inverter/ev-soc-meter.svelte';
	import type { EvccLoadpoint } from '$lib/evcc/store.svelte';

	let { lp }: { lp: EvccLoadpoint } = $props();
</script>

{#if lp.vehicleSoc !== null}
	<EvSocMeter {lp} />
{:else if lp.vehicleTitle}
	<span class="flex items-baseline gap-2 border-t border-border/40 pt-2 text-xs">
		<span class="min-w-0 truncate text-muted-foreground">{lp.vehicleTitle}</span>
	</span>
{/if}
