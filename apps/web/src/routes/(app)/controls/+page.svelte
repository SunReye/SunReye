<script lang="ts">
	import { inverter } from '$lib/inverter/store.svelte';
	import * as m from '$lib/paraglide/messages';
	import { setPageHeader } from '$lib/page-header.svelte';
	import ControlsPanel from './controls-panel.svelte';

	const settings = $derived(inverter.inGroup('settings').filter((metric) => metric.writable));
	// Deye/Sunsynk hybrids expose a time-of-use schedule; gate the editor on the
	// capability the manifest derives from the `timeofuse` metric group.
	const hasTimeOfUse = $derived(inverter.capabilities?.features.includes('time_of_use') ?? false);

	// Nothing to command: neither writable settings nor a schedule editor.
	const nothingWritable = $derived(settings.length === 0 && !hasTimeOfUse);

	$effect(() =>
		setPageHeader(
			m.nav_controls(),
			m.controls_subtitle({ name: inverter.manifest?.name ?? m.controls_this_inverter() })
		)
	);
</script>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
	{#if nothingWritable}
		<div
			class="flex h-40 items-center justify-center border border-border text-sm text-muted-foreground"
		>
			{m.controls_no_writable()}
		</div>
	{:else}
		<ControlsPanel {settings} {hasTimeOfUse} />
	{/if}
</div>
