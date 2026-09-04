<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import * as m from '$lib/paraglide/messages';
	import { type Refusal, unitConflict } from './add-device-logic';
	import { ADDABLE_ROLES, type AddDeviceForm, type DeviceView } from './device-types';
	import { roleLabel } from './role-label';
	import FieldProblem from './field-problem.svelte';

	// Step 2: the address on the gateway — what the device is, and its slave id.
	// The unit hint reads the loaded roster; the server's index is the authority.
	let {
		form = $bindable(),
		devices,
		refusal
	}: {
		form: AddDeviceForm;
		devices: DeviceView[];
		refusal: Refusal | null;
	} = $props();

	const conflict = $derived(unitConflict(devices, form.connectionChoice, form.unitId));
	const unitHint = $derived(conflict ? m.devices_unit_conflict({ id: form.unitId }) : null);
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
		<Input id="device-unit" type="number" min={1} max={247} bind:value={form.unitId} />
		<FieldProblem field="unitId" {refusal} hint={unitHint} />
	</div>
</div>
