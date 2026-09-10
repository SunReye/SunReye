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

	/** One column per reading, up to the full row. Literal, for Tailwind's scan. */
	const COLUMNS = {
		1: 'grid-cols-1',
		2: 'grid-cols-2',
		3: 'grid-cols-2 sm:grid-cols-3'
	} as const;
	const columns = $derived(Math.min(readings.length, 3) as 1 | 2 | 3);
</script>

{#if readings.length === 0}
	<EmptyState message={m.integration_live_none()} />
{:else}
	<div class="flex flex-col gap-2">
		<!-- The hairline-gap trick (a `gap-px` grid over a `bg-border` parent) draws
		     the parent's colour through every cell the readings do not fill, and
		     an integration with one reading against three columns rendered a grey
		     slab beside the only number on the page. So the row is only as wide as
		     it has readings. The classes are written out because Tailwind scans
		     source text — a name built by interpolation reaches the DOM with no
		     rule behind it. -->
		<div class="grid gap-px border border-border bg-border {COLUMNS[columns]}">
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
