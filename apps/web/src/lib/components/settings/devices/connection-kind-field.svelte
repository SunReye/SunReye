<script lang="ts">
	import { coreCapabilities } from '$lib/capabilities.svelte';
	import { Label } from '$lib/components/ui/label';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import * as m from '$lib/paraglide/messages';
	import { CONNECTION_KINDS, type ConnectionKind } from './device-types';

	// WHICH KIND of endpoint — chosen while adding, frozen while editing.
	//
	// Frozen is not a UI nicety: `PATCH /api/connections/:id` answers 409 with
	// `field: "kind"` for a different one, because every device bound to the row
	// was provisioned for its tier (a Modbus slave id, an EVCC loadpoint index)
	// and re-kinding in place would leave them addressed for a bus that no longer
	// exists while their history stays keyed to them.
	let {
		value = $bindable(),
		locked
	}: {
		value: ConnectionKind;
		locked: boolean;
	} = $props();

	const LABELS: Record<ConnectionKind, () => string> = {
		modbus: m.devices_kind_modbus,
		mqtt: m.devices_kind_mqtt
	};

	// A broker carries integrations only; an engine without them offers nothing to add on one.
	const kinds = $derived(
		CONNECTION_KINDS.filter((kind) => kind !== 'mqtt' || coreCapabilities.has('integrations'))
	);
</script>

<div class="flex flex-col gap-1.5 sm:col-span-2">
	<Label for="connection-kind">{m.devices_field_kind()}</Label>
	{#if locked || kinds.length === 1}
		<p id="connection-kind" class="text-sm">{LABELS[value]()}</p>
		{#if locked}
			<span class="text-xs text-muted-foreground">{m.devices_kind_locked()}</span>
		{/if}
	{:else}
		<NativeSelect.Root id="connection-kind" class="w-full" bind:value>
			{#each kinds as option (option)}
				<NativeSelect.Option value={option}>{LABELS[option]()}</NativeSelect.Option>
			{/each}
		</NativeSelect.Root>
	{/if}
</div>
