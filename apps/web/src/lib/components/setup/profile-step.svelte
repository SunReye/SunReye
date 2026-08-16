<script lang="ts">
	import Check from 'phosphor-svelte/lib/Check';
	import Plus from 'phosphor-svelte/lib/Plus';
	import { prefersReducedMotion } from 'svelte/motion';
	import { scale } from 'svelte/transition';
	import { Button } from '$lib/components/ui/button';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import Section from '$lib/components/layout/section.svelte';
	import ExternalProfilesManager from '$lib/components/settings/external-profiles-manager.svelte';
	import GroupedProfileList from '$lib/components/settings/grouped-profile-list.svelte';
	import ProfileRow from '$lib/components/settings/profile-row.svelte';
	import type { RegisteredProfile } from '$lib/components/settings/profile-types';
	import * as m from '$lib/paraglide/messages';

	let {
		profiles,
		selectedId = $bindable(),
		onContinue,
		onExternalInstalled
	}: {
		profiles: RegisteredProfile[];
		selectedId: string | null;
		onContinue: () => void;
		onExternalInstalled: (id: string) => void;
	} = $props();

	let showSources = $state(false);

	const sourcesLabel = $derived(showSources ? m.setup_hide_sources() : m.setup_add_source());
	const checkIn = $derived({ duration: prefersReducedMotion.current ? 0 : 150, start: 0.4 });
	const selectVariant = (selected: boolean) => (selected ? 'default' : 'outline');
</script>

{#snippet profileRow(p: RegisteredProfile)}
	{@const selected = p.id === selectedId}
	<ProfileRow profile={p}>
		{#snippet actions()}
			<!-- Same element across states so the outline→solid colour change tweens. -->
			<Button
				variant={selectVariant(selected)}
				size="sm"
				class="min-w-24 flex-1 sm:flex-none"
				aria-pressed={selected}
				onclick={() => (selectedId = p.id)}
			>
				{#if selected}
					<span in:scale={checkIn} class="flex items-center">
						<Check class="size-4" weight="bold" />
					</span>
					{m.profile_selected()}
				{:else}
					{m.profile_select()}
				{/if}
			</Button>
		{/snippet}
	</ProfileRow>
{/snippet}

<!-- Outside the (app) shell, like the activate step: Section's pad is the whole
     gutter this step gets. The Collapsible below is NOT a section collapse — it
     is the "no inverter?" disclosure inside the card, and its dashed frame is
     chrome one level down, which is why it stays on the card census. -->
<Section title={m.setup_select_profile()}>
	<GroupedProfileList {profiles} row={profileRow} emptyLabel={m.setup_no_profiles()} />

	<Collapsible.Root bind:open={showSources}>
		<div class="flex flex-col gap-3 border border-dashed border-border p-4">
			<div class="flex flex-col gap-1">
				<p class="text-sm font-medium">{m.setup_no_inverter_q()}</p>
				<p class="text-xs text-muted-foreground">{m.setup_download_more()}</p>
			</div>
			<Collapsible.Trigger>
				{#snippet child({ props })}
					<Button variant="outline" size="sm" class="w-full sm:w-auto" {...props}>
						<Plus class="size-4" />
						{sourcesLabel}
					</Button>
				{/snippet}
			</Collapsible.Trigger>
		</div>
		<Collapsible.Content class="mt-4">
			<ExternalProfilesManager onInstalled={onExternalInstalled} />
		</Collapsible.Content>
	</Collapsible.Root>

	<div class="flex justify-end">
		<Button disabled={!selectedId} onclick={onContinue}>{m.action_continue()}</Button>
	</div>
</Section>
