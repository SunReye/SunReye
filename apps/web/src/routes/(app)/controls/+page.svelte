<script lang="ts">
	import { inverter } from '$lib/inverter/store.svelte';
	import * as m from '$lib/paraglide/messages';
	import { setPageHeader } from '$lib/page-header.svelte';
	import PageShell from '$lib/components/layout/page-shell.svelte';
	import EmptyState from '$lib/components/layout/empty-state.svelte';
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

<!-- Narrow: every control here is a labelled field read one line at a time. -->
<PageShell width="narrow">
	{#if nothingWritable}
		<EmptyState message={m.controls_no_writable()} />
	{:else}
		<ControlsPanel {settings} {hasTimeOfUse} />
	{/if}
</PageShell>
