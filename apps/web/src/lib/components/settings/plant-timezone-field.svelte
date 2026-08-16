<script lang="ts">
	// The plant (site) time-zone field: the zone the SERVER buckets daily energy,
	// costs and records by — distinct from the viewer display zone. Extracted from
	// display-form so that form's template stays simple; `draft` is null until the
	// admin-only plant config has loaded, so the field renders only once it has.
	import OptionSelect from './option-select.svelte';
	import { Label } from '$lib/components/ui/label';
	import * as m from '$lib/paraglide/messages';
	import type { PlantConfig } from '$lib/plant.svelte';

	let {
		draft = $bindable(),
		zones
	}: {
		draft: PlantConfig | null;
		zones: { value: string; label: string }[];
	} = $props();
</script>

{#if draft}
	<div class="flex flex-col gap-2">
		<Label for="plant-time-zone">{m.settings_plant_time_zone()}</Label>
		<OptionSelect
			value={draft.timeZone}
			items={zones}
			onchange={(v) => draft && (draft.timeZone = v)}
			triggerClass="max-w-xs"
		/>
		<p class="text-xs text-muted-foreground">{m.settings_plant_time_zone_desc()}</p>
	</div>
{/if}
