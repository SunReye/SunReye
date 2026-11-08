<script lang="ts">
	import CapabilityGate from '$lib/components/capability-gate.svelte';
	import TariffForm from '$lib/components/settings/tariff-form.svelte';
</script>

<CapabilityGate name="pricesAndCosts">
	<TariffForm />
</CapabilityGate>
