<script lang="ts">
	import EnergyDetailDialog from './energy-detail-dialog.svelte';
</script>

<EnergyDetailDialog variant="production" title="Production" triggerClass="p-2">
	{#snippet trigger()}Open detail{/snippet}
</EnergyDetailDialog>
