<script lang="ts">
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import { formatReading } from '$lib/live/plant';
	import { livePlant } from '$lib/live/plant.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { IntegrationView } from '../devices/device-types';
	import { integrationReadings } from './integration-detail';

	// What the integration is REPORTING, off the feed that owns those numbers.
	//
	// The lease is what makes any of it arrive: without it the store subscribes
	// to nothing and every value here is a permanent em dash on a perfectly
	// healthy plant (`$lib/live/wiring.test.ts` is what holds this file to it).
	//
	// The readings are the INTEGRATION'S, not each device's, and the caption says
	// so out loud. `$lib/live/ownership.ts` names plant-wide ids only —
	// `evcc.charge.power` is every loadpoint's power summed — so there is no id
	// for "Carport's power" to read, and reaching past `livePlant` into the EVCC
	// store for a per-loadpoint number is exactly the cross-topic merge that
	// table exists to forbid. A labelled total is honest; a per-row number that
	// is really the total is the bug `ownership.ts` was written after.
	//
	// Nothing peels `.value` off a `Reading`: `formatReading` is handed the whole
	// thing, so a number that stopped being refreshed is shown with its marker
	// instead of sitting there looking current.
	let { integration }: { integration: IntegrationView } = $props();

	$effect(() => livePlant.lease());

	const readings = $derived(integrationReadings(integration));
</script>

{#if readings.length === 0}
	<EmptyState message={m.integration_live_none()} />
{:else}
	<div class="flex flex-col gap-2">
		<div class="grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-3">
			{#each readings as reading (reading.id)}
				<div class="flex flex-col gap-1 bg-background p-3" data-reading={reading.id}>
					<span class="text-xs text-muted-foreground">{reading.label()}</span>
					<span class="text-xl font-semibold tabular-nums tracking-tight">
						{formatReading(
							livePlant.read(reading.id),
							(value) => `${Math.round(value)} ${reading.unit}`,
							m.live_reading_stale()
						)}
					</span>
				</div>
			{/each}
		</div>
		<p class="text-xs text-muted-foreground">{m.integration_live_plant_wide()}</p>
	</div>
{/if}
