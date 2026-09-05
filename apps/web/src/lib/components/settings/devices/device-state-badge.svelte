<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import StatusBadge from '../status-badge.svelte';
	import type { DeviceView } from './device-types';

	// The one badge a device carries: retired, polled, or stored-but-not-polled.
	// The last one explains itself on hover, because "not polled" reads as a
	// fault and is a release limit.
	let { device }: { device: DeviceView } = $props();
</script>

{#if device.retiredAt !== null}
	<StatusBadge label={m.devices_badge_retired()} />
{:else if device.polled}
	<StatusBadge ok label={m.devices_badge_polling()} />
{:else}
	<span title={m.devices_not_polled_hint()}>
		<StatusBadge label={m.devices_badge_not_polled()} />
	</span>
{/if}
