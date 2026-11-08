<script lang="ts">
	import CapabilityGate from '$lib/components/capability-gate.svelte';

	const { children } = $props();
</script>

<!-- Both the index and the peak-shaving page read the `automations` stream, which a core that does
     not serve automations denies: they render nothing rather than a page that waits for it. -->
<CapabilityGate name="automations">
	{@render children()}
</CapabilityGate>
