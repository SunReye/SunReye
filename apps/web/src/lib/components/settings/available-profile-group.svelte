<script lang="ts">
	import CaretDown from "phosphor-svelte/lib/CaretDown";
	import * as Collapsible from "$lib/components/ui/collapsible";
	import AvailableProfileRow from "./available-profile-row.svelte";
	import type {
		AvailableProfile,
		FamilyGroup,
		ManufacturerGroup,
		Source
	} from "./profile-types";

	let {
		group,
		sources,
		busyId,
		onInstall
	}: {
		group: ManufacturerGroup;
		sources: Source[];
		busyId: string | null;
		onInstall: (p: AvailableProfile) => void;
	} = $props();

	/** Families the user has manually collapsed (keyed by family key). */
	let collapsedFamilies = $state<Record<string, boolean>>({});
</script>

{#snippet familyRows(family: FamilyGroup)}
	<div class="flex flex-col divide-y divide-border">
		{#each family.profiles as p (p.source + p.id)}
			<AvailableProfileRow profile={p} {sources} {busyId} {onInstall} />
		{/each}
	</div>
{/snippet}

<Collapsible.Root>
	<Collapsible.Trigger
		class="group flex w-full items-center gap-2 border-b border-border py-2 text-left text-sm font-medium"
	>
		<CaretDown
			class="size-4 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90"
		/>
		{group.manufacturer}
		<span class="text-xs text-muted-foreground">({group.count})</span>
	</Collapsible.Trigger>
	<Collapsible.Content>
		<div class="flex flex-col gap-1 pl-3">
			{#each group.families as f (f.key)}
				{#if f.profiles.length > 1}
					<Collapsible.Root
						open={!collapsedFamilies[f.key]}
						onOpenChange={(v) => (collapsedFamilies[f.key] = !v)}
					>
						<Collapsible.Trigger
							class="group flex w-full items-center gap-2 border-b border-border py-2 text-left text-xs font-medium text-muted-foreground"
						>
							<CaretDown
								class="size-3.5 transition-transform group-data-[state=closed]:-rotate-90"
							/>
							{f.label}
							<span>({f.profiles.length})</span>
						</Collapsible.Trigger>
						<Collapsible.Content>
							{@render familyRows(f)}
						</Collapsible.Content>
					</Collapsible.Root>
				{:else}
					{@render familyRows(f)}
				{/if}
			{/each}
		</div>
	</Collapsible.Content>
</Collapsible.Root>
