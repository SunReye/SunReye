<script lang="ts">
	import * as Table from '$lib/components/ui/table';
	import TouSlotRow from './_shared/tou-slot-row.svelte';
	import * as msg from '$lib/paraglide/messages';
	import type { TouController } from '$lib/inverter/tou.svelte';

	let { controller }: { controller: TouController } = $props();

	const slots = $derived(controller.slots);
	// Battery mode decides which target column applies — show only that one.
	const mode = $derived(controller.targetMode);
	const showVoltage = $derived(mode !== 'soc');
	const showSoc = $derived(mode !== 'voltage');
</script>

<div class="overflow-x-auto">
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head class="w-12">{msg.tou_slot()}</Table.Head>
				<Table.Head>{msg.label_enabled()}</Table.Head>
				<Table.Head>{msg.tou_start()}</Table.Head>
				<Table.Head>{msg.tou_power()}</Table.Head>
				{#if showVoltage}
					<Table.Head>{msg.tou_voltage()}</Table.Head>
				{/if}
				{#if showSoc}
					<Table.Head>{msg.tou_soc()}</Table.Head>
				{/if}
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each slots as slot (slot.index)}
				<TouSlotRow {controller} {slot} {showVoltage} {showSoc} />
			{/each}
		</Table.Body>
	</Table.Root>
</div>
