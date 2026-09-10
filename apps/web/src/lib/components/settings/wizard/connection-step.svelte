<script lang="ts">
	import { Label } from '$lib/components/ui/label';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import * as m from '$lib/paraglide/messages';
	import type { ConnectionView } from '../devices/device-types';
	import type { WizardConnection } from './add-wizard';
	import ConnectionGroup from './connection-group.svelte';

	// STEP 1 — which endpoint. Every kind is offered, grouped by kind, which is
	// the change that makes this a wizard rather than the old dialog: that one
	// listed Modbus gateways only, because a Modbus device was the only thing it
	// could add.
	let {
		connections,
		chosen = $bindable(null)
	}: {
		connections: readonly ConnectionView[];
		chosen: WizardConnection | null;
	} = $props();

	const KIND_LABEL: Record<string, () => string> = {
		modbus: m.devices_kind_modbus,
		mqtt: m.devices_kind_mqtt
	};

	const groups = $derived(
		[...new Set(connections.map((c) => c.kind))].map((kind) => ({
			kind,
			label: KIND_LABEL[kind]?.() ?? kind,
			rows: connections.filter((c) => c.kind === kind)
		}))
	);

	const value = $derived(chosen?.mode === 'existing' ? String(chosen.id) : '');
</script>

<div class="flex flex-col gap-1.5">
	<Label for="wizard-connection">{m.wizard_step_connection()}</Label>
	<NativeSelect.Root
		id="wizard-connection"
		{value}
		onchange={(e) => {
			const id = Number(e.currentTarget.value);
			chosen = Number.isFinite(id) && id > 0 ? { mode: 'existing', id } : null;
		}}
	>
		<NativeSelect.Option value="">{m.wizard_connection_placeholder()}</NativeSelect.Option>
		{#each groups as group (group.kind)}
			<ConnectionGroup label={group.label} rows={group.rows} />
		{/each}
	</NativeSelect.Root>
	<p class="text-xs text-muted-foreground">{m.wizard_connection_hint()}</p>
</div>
