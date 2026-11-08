<script lang="ts">
	import CapabilityGate from '$lib/components/capability-gate.svelte';
	import SpotPriceForm from '$lib/components/settings/spot-price-form.svelte';
</script>

<CapabilityGate name="pricesAndCosts">
	<SpotPriceForm />
</CapabilityGate>
