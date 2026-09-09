<script lang="ts">
	import RangeSwitcher from '$lib/components/inverter/range-switcher.svelte';
	import { source } from '$lib/source.svelte';
	import { sourceOptions } from '$lib/source';
	import * as m from '$lib/paraglide/messages';

	// The plant, or one of its devices. Lives in the app header rather than on a
	// page: a device chosen on the overview is the device the statistics page
	// prices and the history page plots — one scope, not one per page.
	const options = $derived(source.sources ? sourceOptions(source.sources, m.source_plant()) : []);
</script>

{#if source.offersChoice}
	<div class="ml-auto flex min-w-0 items-center" data-source-switcher>
		<RangeSwitcher
			{options}
			bind:value={() => source.current, (v) => source.select(v)}
			label={m.source_switcher_label()}
		/>
	</div>
{/if}
