<script lang="ts">
	/**
	 * Which device the dashboard is showing.
	 *
	 * Renders nothing at all for a plant with one device, which is every install
	 * today — a picker with a single entry is furniture that costs a tap target
	 * in the header. Selecting goes through `devices.select`, never through the
	 * inverter store directly: the readings have to be cleared in the same
	 * breath, or every tile keeps painting the previous machine's numbers with a
	 * current timestamp.
	 */
	import { devices } from '$lib/live/devices.svelte';
	import { TOOLBAR_CONTROL_H } from '$lib/layout/tokens';
	import NativeSelect from '$lib/components/ui/native-select/native-select.svelte';
	import * as m from '$lib/paraglide/messages';

	// The list is loaded once; a switcher on any page can ask for it.
	$effect(() => {
		void devices.load();
	});

	const current = $derived(devices.selected?.id ?? '');
</script>

{#if devices.hasChoice}
	<NativeSelect
		value={current}
		onchange={(event) => {
			void devices.select((event.currentTarget as HTMLSelectElement).value || null);
		}}
		class={TOOLBAR_CONTROL_H}
		aria-label={m.device_switcher_label()}
	>
		{#each devices.devices as device (device.id)}
			<option value={device.id}>{device.label}</option>
		{/each}
	</NativeSelect>
{/if}
