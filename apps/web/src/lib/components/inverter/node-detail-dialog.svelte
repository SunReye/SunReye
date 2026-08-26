<script lang="ts">
	// One power-flow node's readings, opened from the node itself. What /system
	// used to lay out as a page of panels arrives here instead: the node's own
	// quantity with its history on top, then the rest of that subsystem.
	import * as Dialog from '$lib/components/ui/dialog';
	import type { NodeDetail } from '$lib/inverter/node-details';
	import NodeDetailBody from './_shared/node-detail-body.svelte';
	import * as m from '$lib/paraglide/messages';

	let {
		detail,
		triggerClass,
		triggerStyle,
		children
	}: {
		detail: NodeDetail;
		/** Classes for the trigger button — the node box is the trigger. */
		triggerClass: string;
		/** Inline style for the box's own glow, which is a computed colour. */
		triggerStyle?: string;
		/** The node's own visuals, rendered inside the trigger. */
		children: import('svelte').Snippet;
	} = $props();
</script>

<Dialog.Root>
	<!-- The box is the whole hit area: 56px at its smallest, so it clears the
	     44px floor without spending the TAP inset. -->
	<Dialog.Trigger
		class={triggerClass}
		style={triggerStyle}
		aria-label={m.flow_node_details({ name: detail.title })}
	>
		{@render children()}
	</Dialog.Trigger>
	<!-- Wider than the default `sm:max-w-lg`: the headline chart's designed left
	     gutter (44px, `live-area.svelte`) is clamped to 34px below a 480px PLOT,
	     which clips its topmost y-axis label. 576px of dialog leaves the plot
	     ~528px, so the chart gets its real gutters. A phone falls back to the
	     clamp, as every narrow plot in the app does. -->
	<Dialog.Content class="max-h-[85svh] overflow-y-auto sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title>{detail.title}</Dialog.Title>
		</Dialog.Header>
		<NodeDetailBody {detail} />
	</Dialog.Content>
</Dialog.Root>
