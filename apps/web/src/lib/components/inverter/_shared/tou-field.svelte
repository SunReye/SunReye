<script lang="ts">
	// One labelled field of the TOU slot editor. Renders nothing when the profile
	// doesn't map the metric (or the battery mode doesn't apply to it), so the form
	// shows exactly the registers this inverter actually has — and the metric reaches
	// the control already narrowed to non-undefined.
	import type { Snippet } from 'svelte';
	import { Label } from '$lib/components/ui/label';
	import type { ManifestMetric } from '$lib/inverter/types';

	let {
		metric,
		label,
		labelFor,
		class: className = '',
		aside,
		children
	}: {
		/** The slot's metric for this field, or undefined to render nothing. */
		metric: ManifestMetric | undefined;
		label: string;
		/** `for`/`id` pairing when the control is a single labelable input. */
		labelFor?: string;
		/** Extra classes on the field wrapper (e.g. a full-width span). */
		class?: string;
		/** Optional readout pinned opposite the label (e.g. the live slider value). */
		aside?: Snippet;
		children: Snippet<[ManifestMetric]>;
	} = $props();
</script>

{#if metric}
	<div class="flex flex-col gap-1.5 {className}">
		{#if aside}
			<div class="flex items-center justify-between">
				<Label for={labelFor}>{label}</Label>
				{@render aside()}
			</div>
		{:else}
			<Label for={labelFor}>{label}</Label>
		{/if}
		{@render children(metric)}
	</div>
{/if}
