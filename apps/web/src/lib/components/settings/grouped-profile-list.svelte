<script lang="ts">
	import type { Snippet } from "svelte";
	import MagnifyingGlass from "phosphor-svelte/lib/MagnifyingGlass";
	import { Input } from "$lib/components/ui/input";
	import ProfileManufacturerGroup from "./profile-manufacturer-group.svelte";
	import type { RegisteredProfile } from "./profile-types";
	import * as m from "$lib/paraglide/messages";

	let {
		profiles,
		row,
		exclude,
		searchPlaceholder = m.profiles_search_placeholder(),
		emptyLabel = m.profiles_none_available()
	}: {
		profiles: RegisteredProfile[];
		/** Renders one profile; its root element is a direct child of a `divide-y` group. */
		row: Snippet<[RegisteredProfile]>;
		/** Profiles to keep out of the groups (e.g. an active one pinned by the caller). */
		exclude?: (p: RegisteredProfile) => boolean;
		searchPlaceholder?: string;
		/** Shown when there are no groupable profiles at all (no query). */
		emptyLabel?: string;
	} = $props();

	let search = $state("");
	/** Manufacturer groups the user has manually collapsed (only honoured when not searching). */
	let collapsed = $state<Record<string, boolean>>({});

	const query = $derived(search.trim().toLowerCase());
	const candidates = $derived(profiles.filter((p) => !exclude?.(p)));

	const matchesQuery = (p: RegisteredProfile) =>
		!query || `${p.name} ${p.manufacturer}`.toLowerCase().includes(query);

	const groups = $derived.by(() => {
		const byManufacturer: Record<string, RegisteredProfile[]> = {};
		for (const p of candidates.filter(matchesQuery)) {
			(byManufacturer[p.manufacturer || "Other"] ??= []).push(p);
		}
		return Object.entries(byManufacturer).sort(([a], [b]) => a.localeCompare(b));
	});

	// While searching every group stays open; the manual collapse state only
	// applies to the unfiltered list.
	const isOpen = (manufacturer: string) => query !== "" || !collapsed[manufacturer];
	const setOpen = (manufacturer: string, open: boolean) => {
		if (!query) collapsed[manufacturer] = !open;
	};
</script>

{#if candidates.length === 0}
	<p class="py-2 text-sm text-muted-foreground">{emptyLabel}</p>
{:else}
	<div class="relative">
		<MagnifyingGlass
			class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
		/>
		<Input placeholder={searchPlaceholder} bind:value={search} class="pl-9" />
	</div>

	{#if groups.length === 0}
		<p class="py-2 text-sm text-muted-foreground">{m.profiles_no_match({ query: search })}</p>
	{:else}
		<div class="flex flex-col gap-1">
			{#each groups as [manufacturer, list] (manufacturer)}
				<ProfileManufacturerGroup
					{manufacturer}
					profiles={list}
					{row}
					open={isOpen(manufacturer)}
					onOpenChange={(v) => setOpen(manufacturer, v)}
				/>
			{/each}
		</div>
	{/if}
{/if}
