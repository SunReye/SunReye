<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import LabelledField from './labelled-field.svelte';
	import * as m from '$lib/paraglide/messages';

	/**
	 * THE CONSEQUENCE, SHOWN WHILE IT IS STILL EDITABLE.
	 *
	 * The MQTT topic both slugs are about to be frozen into, the sentence that says
	 * so, and — only while `editable` — the two fields that can still correct them.
	 * After the retained Home Assistant announcement goes out there is no edit that
	 * is not an orphaning, and the server refuses one
	 * (`apps/server/src/migration/onboarding-plan.ts`).
	 *
	 * Its own component because the panel is the whole point of the onboarding
	 * screen: leaving it inline made a 235-line template nobody could read the shape
	 * of.
	 */
	let {
		topic,
		plantSlug,
		deviceSlug,
		editable,
		errors,
		onPlantSlug,
		onDeviceSlug
	}: {
		/** `<plant-slug>/<device-slug>`, live. */
		topic: string;
		plantSlug: string;
		deviceSlug: string;
		/** Whether the one-time window is still open. */
		editable: boolean;
		errors: Record<string, string>;
		onPlantSlug: (value: string) => void;
		onDeviceSlug: (value: string) => void;
	} = $props();

	let editing = $state(false);

	const note = $derived(
		editable ? m.migration_slug_frozen_note() : m.migration_slug_frozen_already()
	);
	const showFields = $derived(editable && editing);
	const showEditButton = $derived(editable && !editing);
</script>

<!-- A muted panel rather than a bordered one: the section primitives own
     `border border-border`, and this is a readout inside a card, not a card. -->
<div class="flex flex-col gap-2 bg-muted/40 px-3 py-2">
	<span class="font-mono text-xs wrap-break-word">{m.migration_slug_preview({ topic })}</span>
	<span class="text-xs text-muted-foreground">{note}</span>
	{#if showEditButton}
		<Button
			type="button"
			variant="link"
			size="sm"
			class="h-9 self-start px-0 sm:h-8"
			onclick={() => (editing = true)}
		>
			{m.migration_slug_edit()}
		</Button>
	{/if}
</div>

{#if showFields}
	<LabelledField
		id="plant-slug"
		label={m.migration_slug_plant_label()}
		value={plantSlug}
		error={errors.plantSlug}
		onValue={onPlantSlug}
	/>
	<LabelledField
		id="device-slug"
		label={m.migration_slug_device_label()}
		value={deviceSlug}
		error={errors.deviceSlug}
		onValue={onDeviceSlug}
	/>
{/if}
