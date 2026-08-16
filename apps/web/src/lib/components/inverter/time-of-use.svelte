<script lang="ts">
	import * as Tabs from '$lib/components/ui/tabs';
	import Section from '$lib/components/layout/section.svelte';
	import ControlRow from './control-row.svelte';
	import TouTimeline from './tou-timeline.svelte';
	import TouTable from './tou-table.svelte';
	import * as m from '$lib/paraglide/messages';
	import { TouController } from '$lib/inverter/tou.svelte';

	// One controller owns the optimistic write state so both views stay in sync.
	const controller = new TouController();
	const selling = $derived(controller.selling);
	// Lead-acid batteries are driven by target voltage, lithium by target SOC.
	const isVoltage = $derived(controller.targetMode === 'voltage');
	// Which target the schedule is written in — the sentence that used to be a
	// paragraph the header row had to make room for, now the section caption.
	const scheduleDesc = $derived(
		isVoltage ? m.tou_schedule_desc_voltage() : m.tou_schedule_desc_soc()
	);
</script>

<!-- Tabs.Root WRAPS the section rather than sitting inside it: the tab list is a
     header action, and a `Tabs.List` finds its root through the render tree. Left
     beside the section instead of around it, the triggers would come up with no
     context and the editor could not be switched at all. -->
<Tabs.Root value="visual">
	<Section title={m.tou_schedule_title()} caption={scheduleDesc}>
		{#snippet actions()}
			<Tabs.List variant="line">
				<Tabs.Trigger value="visual">{m.tou_tab_visual()}</Tabs.Trigger>
				<Tabs.Trigger value="table">{m.tou_tab_table()}</Tabs.Trigger>
			</Tabs.List>
		{/snippet}

		{#if selling}
			<ControlRow metric={selling} />
		{/if}

		<!-- No pad of their own: the section body already spaces its blocks, and
		     the extra `pt-2` was compensating for a header that had none. -->
		<Tabs.Content value="visual">
			<TouTimeline {controller} />
		</Tabs.Content>
		<Tabs.Content value="table">
			<TouTable {controller} />
		</Tabs.Content>
	</Section>
</Tabs.Root>
