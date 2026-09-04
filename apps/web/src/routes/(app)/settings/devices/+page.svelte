<script lang="ts">
	import DevicesForm from '$lib/components/settings/devices/devices-form.svelte';
	import { getSettingsStatus } from '../status-context';

	const status = getSettingsStatus();
</script>

<DevicesForm status={status.current?.inverter ?? null} />
