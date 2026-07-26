<script lang="ts">
	import GroupedProfileList from "./grouped-profile-list.svelte";
	import InstalledProfileActions from "./installed-profile-actions.svelte";
	import ProfileRow from "./profile-row.svelte";
	import SettingsSection from "./settings-section.svelte";
	import type { RegisteredProfile } from "./profile-types";
	import * as m from "$lib/paraglide/messages";

	let {
		profiles,
		busyId,
		pendingActiveId,
		onSetActive,
		onUninstall,
		onRestart
	}: {
		profiles: RegisteredProfile[];
		busyId: string | null;
		/** Profile queued to become active on the next restart, if any. */
		pendingActiveId: string | null;
		onSetActive: (p: RegisteredProfile) => void;
		onUninstall: (p: RegisteredProfile) => void;
		onRestart: () => void;
	} = $props();

	// The active profile is pinned to the top and never hidden by search.
	const activeProfile = $derived(profiles.find((p) => p.active));

	/** Where the profile came from, appended to the manufacturer/version line. */
	const origin = (p: RegisteredProfile) =>
		` · ${p.builtin ? m.profiles_builtin() : m.profiles_downloaded()}`;
</script>

{#snippet profileRow(p: RegisteredProfile)}
	<ProfileRow
		profile={p}
		active={p.active}
		pending={p.id === pendingActiveId}
		detail={origin(p)}
	>
		{#snippet actions()}
			<InstalledProfileActions
				profile={p}
				pending={p.id === pendingActiveId}
				{busyId}
				{onSetActive}
				{onUninstall}
				{onRestart}
			/>
		{/snippet}
	</ProfileRow>
{/snippet}

<SettingsSection title={m.profiles_installed_title()}>
	<GroupedProfileList
		{profiles}
		row={profileRow}
		exclude={(p) => p.active}
		emptyLabel={m.profiles_none_other()}
	>
		{#snippet pinned()}
			{#if activeProfile}
				<div class="border border-border bg-muted/40 px-3">
					{@render profileRow(activeProfile)}
				</div>
			{/if}
		{/snippet}
	</GroupedProfileList>
</SettingsSection>
