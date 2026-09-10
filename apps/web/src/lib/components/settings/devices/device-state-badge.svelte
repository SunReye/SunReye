<script lang="ts">
	import { resolve } from '$lib/resolve';
	import StatusBadge from '../status-badge.svelte';
	import { deviceBadge } from './device-badge';
	import type { DeviceView } from './device-types';

	// The one badge a device carries. Which badge is `device-badge.ts`'s decision
	// (and its test's); what is left here is whether it is a link, a hover hint
	// or neither.
	let { device }: { device: DeviceView } = $props();

	const badge = $derived(deviceBadge(device));
</script>

{#if badge.href}
	<a href={resolve(badge.href)} class="rounded-md">
		<StatusBadge ok={badge.ok} label={badge.label} />
	</a>
{:else if badge.hint}
	<span title={badge.hint}>
		<StatusBadge ok={badge.ok} label={badge.label} />
	</span>
{:else}
	<StatusBadge ok={badge.ok} label={badge.label} />
{/if}
