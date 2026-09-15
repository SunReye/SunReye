<script lang="ts">
	import { Label } from '$lib/components/ui/label';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import * as m from '$lib/paraglide/messages';
	import { type Refusal, UNIT_IDS, takenUnitIds } from './add-device-logic';
	import type { ConnectionDraft } from './connection-draft';
	import { ADDABLE_ROLES, type AddDeviceForm, type ConnectionView, type DeviceView } from './device-types';
	import FieldProblem from './field-problem.svelte';
	import { roleLabel } from './role-label';
	import UnitScan from './unit-scan.svelte';
	import { chosenModbusParams, scanTargetOf, unitIdHelp } from './unit-scan-logic';

	// Step 2: the address on the gateway — what the device is, and its slave id.
	// The unit id is a picker over 0–247 with the ids already taken ON THIS
	// connection disabled: the same id on another gateway is a different machine.
	// The server's index is still the authority (409), so a taken id chosen
	// through a stale list is shown under the field.
	let {
		form = $bindable(),
		devices,
		refusal,
		connections = [],
		draft = null
	}: {
		form: AddDeviceForm;
		devices: DeviceView[];
		refusal: Refusal | null;
		/** The endpoints, so the unit id can be explained and measured per framing. */
		connections?: readonly ConnectionView[];
		/** The endpoint the ADD WIZARD is creating, when it is creating one. */
		draft?: ConnectionDraft | null;
	} = $props();

	const taken = $derived(takenUnitIds(devices, form.connectionChoice));
	// What this number addresses depends on the framing above it: a bus framing
	// means the inverter's own slave id, a gateway means whatever the gateway
	// says. Same resolution the scan uses, so the text and the probe can never
	// describe two different endpoints.
	const help = $derived(unitIdHelp(chosenModbusParams(form, connections, draft)?.transport ?? null));
	const scanTarget = $derived(scanTargetOf(form, connections, draft));
	const unitHint = $derived(taken.has(form.unitId) ? m.devices_unit_conflict({ id: form.unitId }) : null);
</script>

<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
	<div class="flex flex-col gap-1.5">
		<Label for="device-role">{m.devices_field_role()}</Label>
		<NativeSelect.Root id="device-role" class="w-full" bind:value={form.role}>
			{#each ADDABLE_ROLES as role (role)}
				<NativeSelect.Option value={role}>{roleLabel(role)}</NativeSelect.Option>
			{/each}
		</NativeSelect.Root>
	</div>
	<div class="flex flex-col gap-1.5">
		<Label for="device-unit">{m.devices_field_unit_id()}</Label>
		<NativeSelect.Root id="device-unit" class="w-full" bind:value={form.unitId}>
			{#each UNIT_IDS as id (id)}
				<NativeSelect.Option value={id} disabled={taken.has(id)}>{id}</NativeSelect.Option>
			{/each}
		</NativeSelect.Root>
		<FieldProblem field="unitId" {refusal} hint={unitHint} />
		<UnitScan
			target={scanTarget}
			onFound={(unitId) => (form.unitId = unitId)}
			nothing={m.devices_unit_scan_needs_profile()}
		/>
		{#if help}
			<p class="text-xs text-muted-foreground">{help}</p>
		{/if}
	</div>
</div>
