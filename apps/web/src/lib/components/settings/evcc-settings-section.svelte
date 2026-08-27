<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import Section from '$lib/components/layout/section.svelte';
	import type { EvccForm } from './mqtt-types';
	import * as m from '$lib/paraglide/messages';

	// EVCC ingest reuses the broker configured above but runs its own
	// subscription, independent of the inverter→MQTT publishing toggle.
	let { cfg = $bindable() }: { cfg: EvccForm } = $props();
</script>

<Section title={m.evcc_settings_title()}>
	<div class="flex items-center justify-between gap-4">
		<div class="flex flex-col">
			<Label for="evcc-enabled">{m.label_enabled()}</Label>
			<span class="text-xs text-muted-foreground">{m.evcc_enabled_desc()}</span>
		</div>
		<Switch id="evcc-enabled" bind:checked={cfg.enabled} />
	</div>
	{#if cfg.enabled}
		<div class="flex flex-col gap-1.5">
			<Label for="evcc-topic">{m.evcc_topic_root()}</Label>
			<Input id="evcc-topic" bind:value={cfg.topicRoot} class="max-w-60" placeholder="evcc" />
			<span class="text-xs text-muted-foreground">{m.evcc_topic_hint()}</span>
		</div>
		<div class="flex items-center justify-between gap-4 border-t border-border pt-4">
			<div class="flex flex-col">
				<Label for="evcc-subtract">{m.evcc_subtract_label()}</Label>
				<span class="text-xs text-muted-foreground">{m.evcc_subtract_hint()}</span>
			</div>
			<Switch id="evcc-subtract" bind:checked={cfg.subtractFromHome} />
		</div>
	{/if}
</Section>
