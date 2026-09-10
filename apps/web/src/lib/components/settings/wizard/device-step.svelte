<script lang="ts">
	import AddressFields from '../devices/address-fields.svelte';
	import type { AddDeviceForm, DeviceView } from '../devices/device-types';
	import InverterSection from '../devices/inverter-section.svelte';
	import NameField from '../devices/name-field.svelte';
	import ProfileField from '../devices/profile-field.svelte';
	import type { RegisteredProfile } from '../profile-types';

	// STEP 3, THE DEVICE ARM — the add dialog's own fields, composed here and
	// restated nowhere. A device is a name, a role, a slave id and a register
	// profile (and, for an inverter, a roof and a pack); asked through the
	// catalog renderer it printed "arrays: array" and never asked for a name at
	// all, which is the field `POST /api/devices` requires.
	//
	// The GATEWAY field is deliberately absent: step 1 already asked which
	// endpoint, and asking again here is how the two answers disagree. The form
	// carries that choice so the unit-id picker knows whose ids are taken.
	//
	// `refusal` is null throughout: the wizard reports a failed submit as a
	// toast, because the connection may have been created in the same press and
	// which half happened is the more important half of the message.
	let {
		form = $bindable(),
		devices,
		registered,
		onInstalled
	}: {
		form: AddDeviceForm;
		/** The roster, so the unit-id picker can disable the ids already taken. */
		devices: DeviceView[];
		registered: RegisteredProfile[];
		onInstalled: (id: string) => void;
	} = $props();

	const isInverter = $derived(form.role === 'inverter');
</script>

<div class="flex flex-col gap-4">
	<AddressFields bind:form {devices} refusal={null} />
	<NameField bind:form refusal={null} />
	<ProfileField bind:form {registered} refusal={null} {onInstalled} />
	{#if isInverter}
		<InverterSection bind:form />
	{/if}
</div>
