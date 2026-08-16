<script lang="ts">
	import AutomationCard from '$lib/components/automations/automation-card.svelte';
	import { automationStream } from '$lib/components/automations/stream.svelte';
	import { setPageHeader } from '$lib/page-header.svelte';
	import * as m from '$lib/paraglide/messages';

	// Index of the automations, one card each with its live run state. Kept as a
	// derived list rather than hard-coded markup so a second automation is one
	// entry, not a new layout. The run state rides the shared live stream.
	$effect(() => automationStream.lease());
	const peakShaving = $derived(automationStream.status);

	const modeNote = $derived(
		peakShaving?.mode === 'grid-friendly'
			? m.peak_shaving_mode_grid()
			: m.peak_shaving_mode_exports()
	);

	const automations = $derived([
		{
			id: 'peak-shaving',
			href: '/automations/peak-shaving' as const,
			title: m.peak_shaving_title(),
			description: m.peak_shaving_desc(),
			state: peakShaving?.state ?? 'disabled',
			note: `${m.peak_shaving_mode()}: ${modeNote}`
		}
	]);

	$effect(() => setPageHeader(m.nav_automations(), m.automations_subtitle()));
</script>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
	{#each automations as automation (automation.id)}
		<AutomationCard
			href={automation.href}
			title={automation.title}
			description={automation.description}
			state={automation.state}
			note={automation.note}
		/>
	{/each}
</div>
