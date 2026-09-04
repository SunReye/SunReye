<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import { Button } from '$lib/components/ui/button';
	import Section from '$lib/components/layout/section.svelte';
	import * as m from '$lib/paraglide/messages';
	import { apiErrorText } from '../api-error';
	import AddDeviceDialog from './add-device-dialog.svelte';
	import DeviceList from './device-list.svelte';
	import type { DeviceRoster, DeviceView } from './device-types';
	import RetireDialog from './retire-dialog.svelte';

	// The devices panel: the plant's roster, retired ones included (a device the
	// UI cannot see is a device nobody can restore), and the one way to add to it.
	let roster = $state<DeviceRoster | null>(null);
	let loadFailed = $state(false);
	let busyId = $state<number | null>(null);
	let addOpen = $state(false);
	let retiring = $state<DeviceView | null>(null);

	async function load() {
		const { data, error } = await api.api.devices.get();
		loadFailed = Boolean(error);
		if (data) roster = data as DeviceRoster;
	}

	onMount(load);

	async function patch(device: DeviceView, body: { name?: string; retired?: boolean }) {
		busyId = device.id;
		const result = await api.api.devices({ id: String(device.id) }).patch(body);
		busyId = null;
		if (!result.data) {
			const error = apiErrorText(result.error?.value, m.error_unknown());
			toast.error(m.devices_toast_update_failed({ error }));
			return;
		}
		toast.success(m.devices_toast_updated({ name: result.data.name }));
		await load();
	}

	async function confirmRetire() {
		const target = retiring;
		retiring = null;
		if (target) await patch(target, { retired: true });
	}
</script>

<div class="flex flex-col gap-6">
	<Section title={m.devices_section_title()}>
		{#snippet actions()}
			<Button size="sm" class="h-9 sm:h-8" onclick={() => (addOpen = true)} disabled={!roster}>
				{m.devices_add()}
			</Button>
		{/snippet}
		<DeviceList
			{roster}
			{loadFailed}
			{busyId}
			onRename={(d, name) => patch(d, { name })}
			onRetire={(d) => (retiring = d)}
			onRestore={(d) => patch(d, { retired: false })}
		/>
	</Section>
</div>

{#if roster}
	<AddDeviceDialog bind:open={addOpen} connections={roster.connections} devices={roster.devices} onAdded={load} />
{/if}

<RetireDialog device={retiring} onCancel={() => (retiring = null)} onConfirm={confirmRetire} />
