<script lang="ts">
	import GroupedProfileList from "./grouped-profile-list.svelte";
	import InstalledProfileActions from "./installed-profile-actions.svelte";
	import ProfileRow from "./profile-row.svelte";
	import Section from '$lib/components/layout/section.svelte';
	import type { RegisteredProfile } from "./profile-types";
	import * as m from "$lib/paraglide/messages";

	let {
		profiles,
		busyId,
		onUninstall
	}: {
		profiles: RegisteredProfile[];
		busyId: string | null;
		onUninstall: (p: RegisteredProfile) => void;
	} = $props();

	// Every profile a device uses is pinned to the top and never hidden by
	// search. Plural: a plant with two devices can run two profiles at once, and
	// "in use" is a fact about the devices, not a single setting.
	const inUse = $derived(profiles.filter((p) => p.active));

	/** Where the profile came from, appended to the manufacturer/version line. */
	const origin = (p: RegisteredProfile) =>
		` · ${p.builtin ? m.profiles_builtin() : m.profiles_downloaded()}`;
</script>

{#snippet profileRow(p: RegisteredProfile)}
	<ProfileRow profile={p} active={p.active} detail={origin(p)}>
		{#snippet actions()}
			<InstalledProfileActions profile={p} {busyId} {onUninstall} />
		{/snippet}
	</ProfileRow>
{/snippet}

<Section title={m.profiles_installed_title()}>
	<!-- Profiles in use are pinned above the list, so search never hides them. -->
	{#if inUse.length > 0}
		<div class="flex flex-col divide-y divide-border border border-border bg-muted/40 px-3">
			{#each inUse as p (p.id)}
				{@render profileRow(p)}
			{/each}
		</div>
	{/if}
	<GroupedProfileList
		{profiles}
		row={profileRow}
		exclude={(p) => p.active}
		emptyLabel={m.profiles_none_other()}
	/>
</Section>
