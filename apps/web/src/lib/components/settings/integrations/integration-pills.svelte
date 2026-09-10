<script lang="ts">
	import StatusBadge from '../status-badge.svelte';
	import type { IntegrationStatusView } from './integration-detail';

	// Only what needs acting on is a pill.
	//
	// A healthy, enabled integration renders NOTHING here: "Connected" and
	// "Enabled" side by side were the two loudest things on a page whose whole
	// subject is this integration, and neither was a state anybody acts on. What
	// a working endpoint has to say is said better one line below, where the
	// detail reports WHEN it last connected.
	let {
		status,
		enabled,
		disabledLabel
	}: {
		status: IntegrationStatusView;
		enabled: boolean;
		/** The word for the off state; the on state has no pill. */
		disabledLabel: string;
	} = $props();

	const pills = $derived([
		...(status.ok ? [] : [{ key: 'status', label: status.label }]),
		...(enabled ? [] : [{ key: 'enabled', label: disabledLabel }])
	]);
</script>

{#if pills.length > 0}
	<div class="flex flex-wrap items-center gap-2">
		{#each pills as pill (pill.key)}
			<StatusBadge ok={false} label={pill.label} />
		{/each}
	</div>
{/if}
