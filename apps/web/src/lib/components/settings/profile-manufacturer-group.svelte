<script lang="ts">
	import type { Snippet } from "svelte";
	import CaretDown from "phosphor-svelte/lib/CaretDown";
	import * as Collapsible from "$lib/components/ui/collapsible";
	import type { RegisteredProfile } from "./profile-types";

	// One manufacturer bucket of a registered-profile list: a collapsible header
	// carrying the bucket size, and the caller's row for each profile.
	let {
		manufacturer,
		profiles,
		row,
		open,
		onOpenChange
	}: {
		manufacturer: string;
		profiles: RegisteredProfile[];
		row: Snippet<[RegisteredProfile]>;
		open: boolean;
		onOpenChange: (open: boolean) => void;
	} = $props();
</script>

<Collapsible.Root {open} {onOpenChange}>
	<Collapsible.Trigger
		class="group flex w-full items-center gap-2 border-b border-border py-2 text-left text-sm font-medium"
	>
		<CaretDown
			class="size-4 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90"
		/>
		{manufacturer}
		<span class="text-xs text-muted-foreground">({profiles.length})</span>
	</Collapsible.Trigger>
	<Collapsible.Content>
		<div class="flex flex-col divide-y divide-border">
			{#each profiles as p (p.id)}
				{@render row(p)}
			{/each}
		</div>
	</Collapsible.Content>
</Collapsible.Root>
