<script lang="ts">
	import CaretDown from 'phosphor-svelte/lib/CaretDown';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import * as m from '$lib/paraglide/messages';
	import { splitRetired } from './device-lifecycle';
	import DeviceRow from './device-row.svelte';
	import type { DeviceHandlers, DeviceView } from './device-types';

	// The devices half of a connection's card: what READS through the endpoint,
	// as opposed to the integrations that RUN over it.
	//
	// Retired devices fold under a closed disclosure at the end. They have to stay
	// reachable — this is the only place one can be restored or deleted — but
	// dimmed rows between the working ones made every card read as half broken.
	//
	// A half that renders nothing when it is empty is the half's own business —
	// pushing that `{#if}` up put the group's template over the complexity
	// ceiling the moment the second half arrived.
	let {
		devices,
		busyId,
		groupKey,
		handlers
	}: {
		devices: readonly DeviceView[];
		busyId: number | null;
		/** The `data-group` handle a spec addresses this half by. */
		groupKey: string;
		handlers: DeviceHandlers;
	} = $props();

	const split = $derived(splitRetired(devices));
</script>

{#snippet rows(list: readonly DeviceView[])}
	{#each list as device (device.id)}
		<DeviceRow {device} busy={busyId === device.id} {handlers} />
	{/each}
{/snippet}

{#if devices.length > 0}
	<div class="flex flex-col divide-y divide-border" data-group={groupKey}>
		{@render rows(split.active)}
		{#if split.retired.length > 0}
			<Collapsible.Root class="py-1" data-retired>
				<Collapsible.Trigger
					class="group flex min-h-11 w-full items-center gap-2 text-left text-xs font-medium tracking-wide text-muted-foreground uppercase sm:min-h-9"
				>
					<CaretDown class="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
					{m.devices_retired_count({ count: split.retired.length })}
				</Collapsible.Trigger>
				<Collapsible.Content class="flex flex-col divide-y divide-border">
					{@render rows(split.retired)}
				</Collapsible.Content>
			</Collapsible.Root>
		{/if}
	</div>
{/if}
