<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as m from '$lib/paraglide/messages';
	import type { RegisteredProfile } from '../profile-types';
	import {
		type Refusal,
		buildAddDeviceBody,
		describeRefusal,
		devicePatch,
		emptyForm,
		formFromDevice,
		probeTargetOf
	} from './add-device-logic';
	import AddressFields from './address-fields.svelte';
	import ConnectionField from './connection-field.svelte';
	import type { ConnectionView, DeviceView } from './device-types';
	import InverterSection from './inverter-section.svelte';
	import NameField from './name-field.svelte';
	import ProbeTest from './probe-test.svelte';
	import ProfileField from './profile-field.svelte';

	// The device dialog — add, or edit when `device` is set: pick or create the
	// gateway, address the device on it, name it, pick the profile that speaks to
	// it. Every choice is a NATIVE select — the operator is on a phone in a cellar
	// as often as at a desk, and the platform picker is the one that works there.
	// The rules live in `./add-device-logic.ts`; each field is its own component;
	// this file holds the form state and the request. An edit sends only what
	// changed, and cannot create a gateway — that is the connection's own dialog.
	let {
		open = $bindable(false),
		device = null,
		connections,
		devices,
		onSaved
	}: {
		open?: boolean;
		/** The device being edited, or null to add one. */
		device?: DeviceView | null;
		connections: ConnectionView[];
		devices: DeviceView[];
		onSaved: (device: DeviceView) => void;
	} = $props();

	// Seeded empty and filled by the open effect below, which is the one place
	// the current connection list is read.
	let form = $state(emptyForm([]));
	let registered = $state<RegisteredProfile[]>([]);
	let submitting = $state(false);
	/** The server's refusal, shown under the field it named. */
	let refusal = $state<Refusal | null>(null);

	const editing = $derived(device !== null);
	const title = $derived(editing ? m.devices_device_dialog_title() : m.devices_dialog_title());
	const description = $derived(
		editing ? m.devices_device_dialog_description() : m.devices_dialog_description()
	);
	const submitLabel = $derived(editing ? m.action_save() : m.devices_add());
	const isInverter = $derived(form.role === 'inverter');
	const probe = $derived(probeTargetOf(form, connections));
	/** For an add, the whole body; for an edit, the changed fields — null while unsendable. */
	const body = $derived(device ? devicePatch(device, form) : buildAddDeviceBody(form));
	/** The other devices, so an edit's own unit id is not shown as taken. */
	const others = $derived(devices.filter((d) => d.id !== device?.id));

	async function loadRegistered() {
		const { data } = await api.api.profiles.get();
		if (data) registered = data as RegisteredProfile[];
	}

	// A fresh form each time the dialog opens: the previous device's values are
	// the wrong defaults for the next one, and the connection list may have grown.
	$effect(() => {
		if (open) {
			form = device ? formFromDevice(device, connections) : emptyForm(connections, devices);
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
		else toast.error(
				(editing ? m.devices_toast_update_failed : m.devices_toast_add_failed)({ error: described.message })
			);
	}

	/** The one request an add or an edit makes; the treaty types each arm. */
	function send() {
		if (device) return api.api.devices({ id: String(device.id) }).patch(body ?? {});
		return api.api.devices.post(body ?? {});
	}

	// `submitting` is not re-checked here: the submit button is disabled while it
	// is set, so a second submit cannot arrive from the form.
	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!body) return;
		submitting = true;
		refusal = null;
		const result = await send();
		submitting = false;
		if (!result.data) {
			report(result.error);
			return;
		}
		const saved = result.data as DeviceView;
		toast.success(editing ? m.devices_toast_updated({ name: saved.name }) : m.devices_toast_added({ name: saved.name }));
		onSaved(saved);
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>

		<form class="flex flex-col gap-4" onsubmit={submit}>
			<ConnectionField bind:form {connections} {refusal} allowNew={!editing} />
			<AddressFields bind:form devices={others} {refusal} />
			<NameField bind:form {refusal} />
			<ProfileField bind:form {registered} {refusal} {onInstalled} />
			<ProbeTest target={probe} nothing={m.devices_probe_needs_profile()} />
			{#if isInverter}
				<InverterSection bind:form />
			{/if}

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>
					{m.action_cancel()}
				</Button>
				<Button type="submit" disabled={!body || submitting}>{submitLabel}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
