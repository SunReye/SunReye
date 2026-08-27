<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import AvailableProfileGroup from "./available-profile-group.svelte";
	import Section from '$lib/components/layout/section.svelte';
	import type { AvailableProfile, FamilyGroup, ManufacturerGroup, Source } from "./profile-types";
	import * as m from "$lib/paraglide/messages";

	let {
		available,
		sources,
		errors,
		browsing,
		busyId,
		onBrowse,
		onInstall
	}: {
		available: AvailableProfile[] | null;
		sources: Source[];
		errors: { source: string; error: string }[];
		browsing: boolean;
		busyId: string | null;
		onBrowse: () => void;
		onInstall: (p: AvailableProfile) => void;
	} = $props();

	// Numeric-aware so "SUN-5K" sorts before "SUN-10K" (plain order puts "10" first).
	const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

	// A `defineFamily` emits a base profile plus per-SKU models; the built output
	// drops the family link, so recover it from the ids. Whatever the naming
	// convention — SKU as a suffix (`deye-sg05lp3` → `deye-sun14k-sg05lp3`) or a
	// suffix on the family (`deye-sg01hp3` → `deye-sg01hp3-5k`) — every model id is
	// a hyphen-token superset of its base id. Cluster on that instead of guessing
	// which segment is the family token, so both conventions group identically.
	const tokenSet = (id: string): Set<string> => new Set(id.split("-"));
	const isSubset = (a: Set<string>, b: Set<string>): boolean => {
		for (const t of a) if (!b.has(t)) return false;
		return true;
	};

	type Family = { base: AvailableProfile; tokens: Set<string>; profiles: AvailableProfile[] };

	/** The most specific family whose id tokens are all contained in `tokens`. */
	function bestBase(families: Family[], tokens: Set<string>): Family | null {
		const bases = families.filter((f) => isSubset(f.tokens, tokens));
		return bases.reduce<Family | null>(
			(best, f) => (best && best.tokens.size >= f.tokens.size ? best : f),
			null
		);
	}

	function clusterFamilies(profiles: AvailableProfile[]): FamilyGroup[] {
		// Fewest tokens first so a base is always seen before its models; the base
		// then seeds the family and every superset id attaches to it.
		const ordered = [...profiles].sort(
			(a, b) => a.id.split("-").length - b.id.split("-").length || collator.compare(a.name, b.name)
		);
		const families: Family[] = [];
		for (const p of ordered) {
			const tokens = tokenSet(p.id);
			// Attach to the most specific matching base; if none match, this id is
			// itself a new family base.
			const best = bestBase(families, tokens);
			if (best) best.profiles.push(p);
			else families.push({ base: p, tokens, profiles: [p] });
		}
		return families
			.map((f) => ({
				key: f.base.id,
				label: f.base.name,
				profiles: f.profiles.sort((a, b) => collator.compare(a.name, b.name))
			}))
			.sort((a, b) => collator.compare(a.label, b.label));
	}

	/** Buckets profiles by manufacturer, with a catch-all for a blank one. */
	function bucketByManufacturer(profiles: AvailableProfile[]): Record<string, AvailableProfile[]> {
		const buckets: Record<string, AvailableProfile[]> = {};
		for (const p of profiles) (buckets[p.manufacturer || "Other"] ??= []).push(p);
		return buckets;
	}

	function toGroup([manufacturer, profiles]: [string, AvailableProfile[]]): ManufacturerGroup {
		const families = clusterFamilies(profiles);
		return { manufacturer, families, count: families.reduce((n, f) => n + f.profiles.length, 0) };
	}

	const groups = $derived.by((): ManufacturerGroup[] =>
		Object.entries(bucketByManufacturer(available ?? []))
			.map(toGroup)
			.sort((a, b) => collator.compare(a.manufacturer, b.manufacturer))
	);

	const browseLabel = $derived(browsing ? m.profiles_browsing() : m.profiles_browse());
	// `null` = never browsed (show the hint); empty = browsed but nothing found.
	const emptyMessage = $derived(
		available === null
			? m.profiles_browse_hint()
			: available.length === 0
				? m.profiles_none_found()
				: null
	);
</script>

<Section title={m.profiles_available_title()}>
	{#snippet actions()}
		<Button variant="outline" size="sm" disabled={browsing} onclick={onBrowse}>
			{browseLabel}
		</Button>
	{/snippet}

	{#each errors as e (e.source)}
		<p class="text-xs text-destructive">{m.profiles_browse_error({ source: e.source, error: e.error })}</p>
	{/each}

	{#if emptyMessage !== null}
		<p class="text-sm text-muted-foreground">{emptyMessage}</p>
	{:else}
		<div class="flex flex-col gap-1">
			{#each groups as g (g.manufacturer)}
				<AvailableProfileGroup group={g} {sources} {busyId} {onInstall} />
			{/each}
		</div>
	{/if}
</Section>
