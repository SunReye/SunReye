<script lang="ts">
	import { SECTION_GAP } from '$lib/layout/tokens';
	import BatteryFields from '../battery-fields.svelte';
	import PvFields from '../pv-fields.svelte';
	import type { AddDeviceForm } from './device-types';

	// The inverter's own description — its strings, their physics, its pack.
	// Rendered only for `role = 'inverter'`; the server refuses these on any
	// other role, and the form sends none for one.
	let { form = $bindable() }: { form: AddDeviceForm } = $props();
</script>

<!-- A block inside the dialog's card, not a card of its own: `Section` heads
     with an uppercase title string and frames a second box, and the two blocks
     below already label themselves (see `section-migration.test.ts`, "Sub-
     headings one level BELOW a card title"). What was hand-drawn here is the
     RHYTHM, and that comes from the token now. -->
<div class="flex flex-col {SECTION_GAP} border-t border-border pt-4">
	<PvFields
		bind:arrays={form.inverter.arrays}
		bind:tempCoeff={form.inverter.tempCoeff}
		bind:loss={form.inverter.loss}
		disabled={false}
	/>
	<BatteryFields
		bind:battUsable={form.inverter.battUsable}
		bind:battCharge={form.inverter.battCharge}
		bind:battReserve={form.inverter.battReserve}
		bind:battNominalV={form.inverter.battNominalV}
		disabled={false}
	/>
</div>
