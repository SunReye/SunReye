<script lang="ts">
	import { Label } from "$lib/components/ui/label";
	import { Switch } from "$lib/components/ui/switch";
	import * as m from "$lib/paraglide/messages";

	// The simulator toggle.
	//
	// A control, not a notice. This used to be a paragraph saying "set by the
	// INVERTER_SIMULATE environment variable" — true for Docker, useless
	// everywhere else, and on an appliance actively wrong: the owner cannot reach
	// that variable, so the path almost everyone uses dead-ended here. They would
	// save their inverter's address, keep seeing invented readings, and have
	// nothing to click.
	//
	// Its own component because the form's template is at the repo's complexity
	// ceiling, and because a switch that owns a piece of copy is a thing on its
	// own. No border: the Section around it is the frame, and a component that
	// draws its own card is what `section-migration.test.ts` exists to stop.
	let { simulate = $bindable() }: { simulate: boolean } = $props();
</script>

<div class="flex items-start justify-between gap-4">
	<div class="flex flex-col gap-1">
		<Label for="inverter-simulate">{m.inverter_simulate_label()}</Label>
		<p class="max-w-prose text-xs text-muted-foreground">
			{m.inverter_simulate_desc()}
		</p>
		{#if simulate}
			<p class="text-xs font-medium text-muted-foreground">
				{m.inverter_simulate_on_notice()}
			</p>
		{/if}
	</div>
	<Switch id="inverter-simulate" bind:checked={simulate} />
</div>
