<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as m from '$lib/paraglide/messages';
	import type { RegisteredProfile } from '../profile-types';
	import { type Refusal, buildAddDeviceBody, describeRefusal, emptyForm } from './add-device-logic';
	import AddressFields from './address-fields.svelte';
	import ConnectionField from './connection-field.svelte';
	import type { ConnectionView, DeviceView } from './device-types';
	import NameField from './name-field.svelte';
	import ProfileField from './profile-field.svelte';

	// The add-device dialog: pick or create the gateway, address the device on
	// it, name it, pick the profile that speaks to it. Every choice is a NATIVE
	// select — the operator is on a phone in a cellar as often as at a desk, and
	// the platform picker is the one that works there. The rules live in
	// `./add-device-logic.ts`; each field is its own component; this file holds
	// the form state and the request.
	let {
		open = $bindable(false),
		connections,
		devices,
		onAdded
	}: {
		open?: boolean;
		connections: ConnectionView[];
		devices: DeviceView[];
		onAdded: (device: DeviceView) => void;
	} = $props();

	// Seeded empty and filled by the open effect below, which is the one place
	// the current connection list is read.
	let form = $state(emptyForm([]));
	let registered = $state<RegisteredProfile[]>([]);
	let submitting = $state(false);
	/** The server's refusal, shown under the field it named. */
	let refusal = $state<Refusal | null>(null);

	const body = $derived(buildAddDeviceBody(form));

	async function loadRegistered() {
		const { data } = await api.api.profiles.get();
		if (data) registered = data as RegisteredProfile[];
	}

	// A fresh form each time the dialog opens: the previous device's values are
	// the wrong defaults for the next one, and the connection list may have grown.
	$effect(() => {
		if (open) {
			form = emptyForm(connections);
			refusal = null;
			void loadRegistered();
		}
	});

	async function onInstalled(id: string) {
		await loadRegistered();
		form.profileId = id;
	}

	function report(error: { value: unknown } | null) {
		const described = describeRefusal(error?.value, m.error_unknown());
		if (described.field) refusal = described;
		else toast.error(m.devices_toast_add_failed({ error: described.message }));
	}

	// `submitting` is not re-checked here: the submit button is disabled while it
	// is set, so a second submit cannot arrive from the form.
	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!body) return;
		submitting = true;
		refusal = null;
		const result = await api.api.devices.post(body);
		submitting = false;
		if (!result.data) {
			report(result.error);
			return;
		}
		toast.success(m.devices_toast_added({ name: result.data.name }));
		onAdded(result.data as DeviceView);
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title>{m.devices_dialog_title()}</Dialog.Title>
			<Dialog.Description>{m.devices_dialog_description()}</Dialog.Description>
		</Dialog.Header>

		<form class="flex flex-col gap-4" onsubmit={submit}>
			<ConnectionField bind:form {connections} {refusal} />
			<AddressFields bind:form {devices} {refusal} />
			<NameField bind:form {refusal} />
			<ProfileField bind:form {registered} {refusal} {onInstalled} />

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>
					{m.action_cancel()}
				</Button>
				<Button type="submit" disabled={!body || submitting}>{m.devices_add()}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
