<script lang="ts">
	import { Label } from '$lib/components/ui/label';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import * as m from '$lib/paraglide/messages';
	import { type Refusal, UNIT_IDS, takenUnitIds } from './add-device-logic';
	import { ADDABLE_ROLES, type AddDeviceForm, type DeviceView } from './device-types';
	import FieldProblem from './field-problem.svelte';
	import { roleLabel } from './role-label';

	// Step 2: the address on the gateway — what the device is, and its slave id.
	// The unit id is a picker over 0–247 with the ids already taken ON THIS
	// connection disabled: the same id on another gateway is a different machine.
	// The server's index is still the authority (409), so a taken id chosen
	// through a stale list is shown under the field.
	let {
		form = $bindable(),
		devices,
		refusal
	}: {
		form: AddDeviceForm;
		devices: DeviceView[];
		refusal: Refusal | null;
	} = $props();

	const taken = $derived(takenUnitIds(devices, form.connectionChoice));
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
	</div>
</div>
