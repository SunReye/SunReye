<script lang="ts">
	import type { Component } from 'svelte';
	import Sun from 'phosphor-svelte/lib/Sun';
	import BatteryChargingIcon from 'phosphor-svelte/lib/BatteryCharging';
	import Lightning from 'phosphor-svelte/lib/Lightning';
	import House from 'phosphor-svelte/lib/House';
	import Engine from 'phosphor-svelte/lib/Engine';
	import CarProfile from 'phosphor-svelte/lib/CarProfile';
	import ArrowDown from 'phosphor-svelte/lib/ArrowDown';
	import ArrowUp from 'phosphor-svelte/lib/ArrowUp';
	import AnimatedNumber from './animated-number.svelte';
	import SocGauge from './_shared/soc-gauge.svelte';
	import SocReadout from './_shared/soc-readout.svelte';
	import NodeDetailDialog from './node-detail-dialog.svelte';
	import type { GraphNode, NodeKind } from '$lib/inverter/power-graph';
	import type { NodeDetail } from '$lib/inverter/node-details';
	import { nodeGlow } from '$lib/inverter/flow-pulse';
	import { motion } from '$lib/motion/tier.svelte';

	let {
		node,
		soc,
		share = 0,
		intervalMs,
		detail
	}: {
		node: GraphNode;
		/** Battery/vehicle state-of-charge (0..100); renders the square gauge when set. */
		soc?: number;
		/** This node's power as a share (0..1) of the plant's remembered peak. The
		 *  glow answers it, so a 300 W night import does not blaze like noon. */
		share?: number;
		/** Sample cadence (ms) of the feed behind `node.value`; forwarded to the
		 *  animated readout so, e.g., the EVCC charger node glides at EVCC's rate
		 *  rather than the inverter feed's. Falls back to the inverter cadence. */
		intervalMs?: number;
		/** This subsystem's readings; the box opens onto them. Absent (the profile
		 *  maps none, or Settings → Sensors hid them) leaves a plain box — a
		 *  trigger that opens an empty dialog is worse than no trigger. */
		detail?: NodeDetail;
	} = $props();

	// Node kind → icon; the graph builder stays a pure module without component
	// imports so it can run under bun test.
	const ICONS: Record<NodeKind, Component> = {
		pv: Sun,
		battery: BatteryChargingIcon,
		load: House,
		generator: Engine,
		grid: Lightning,
		charger: CarProfile
	};
	const Icon = $derived(ICONS[node.kind]);

	const active = $derived(node.flow !== 'idle');
	// The ring renders battery SoC — and vehicle SoC on the EV charger node.
	const gauged = $derived(node.kind === 'battery' || node.kind === 'charger');
	const hasSoc = $derived(gauged && soc !== undefined);
	/** SoC handed to the gauge: `undefined` on nodes that don't show one. */
	const ringSoc = $derived(gauged ? soc : undefined);

	/**
	 * The percentage, whole, or `undefined` on a node that carries none.
	 *
	 * It is the one figure on this hero anybody reads from across a room, so it
	 * is the CONTENT of the node box rather than a badge pinned to its edge — it
	 * used to be a 0.62rem chip on the bottom border, under the repo's own 12 px
	 * phone floor and tinted with the SoC ramp, which puts `--sign-warn`
	 * (`#f59e0b`) on the light theme's white at 2.2:1. The ramp still says what
	 * the number MEANS — on the ring, where a 2.5 px stroke can carry a hue —
	 * while the digits take the surface's own foreground and its full contrast.
	 */
	const socLabel = $derived(hasSoc ? Math.round(soc as number) : undefined);

	/**
	 * The node's icon steps down on a gauged node so the number can lead.
	 *
	 * Both cannot be dominant in a 56 px box, and on a battery the icon is the
	 * redundant one: the caption underneath already names the node. The geometry
	 * gives way to the type rather than the other way round.
	 */
	const iconClass = $derived(
		hasSoc ? 'size-4 sm:size-4.5 2xl:size-6' : 'size-7 sm:size-8 2xl:size-10'
	);

	const iconColor = $derived(active ? node.accent : 'var(--muted-foreground)');

	/**
	 * The node box's transitions, at `full` only.
	 *
	 * Each of them is cheap to declare and expensive to run: the box-shadow is a
	 * 34 px blur that repaints for every frame of its 500 ms, the tint is a
	 * `color-mix` background, and there is one box per node. On the tablets this
	 * tier exists for, a plant whose load wanders across a `pulseShare` bucket
	 * leaves a wave of them running most of the time — measured on the idle
	 * overview, 43 transitions were running at once. Below `full` the box takes
	 * the same colours in one step.
	 */
	const boxTransition = $derived(
		motion.tier === 'full' ? 'transition-[box-shadow,border-color,background] duration-500' : ''
	);
	/** Same, for the fade an idle node takes. */
	const fadeTransition = $derived(motion.tier === 'full' ? 'transition-opacity duration-500' : '');

	/** The node box, shared by the plain and the tappable variant so the two can
	 *  never drift apart in size — the anchors are computed against this box. */
	const BOX_CLASS = 'relative block size-14 sm:size-16 2xl:size-20';

	// Direction chevron beside the state caption; idle nodes show none.
	const FlowIcon = $derived(
		node.flow === 'in' ? ArrowDown : node.flow === 'out' ? ArrowUp : undefined
	);

	// The caption stack sits above or below the box depending on the node's place in
	// the diagram, flipping the flex order so label/value keep their reading order.
	const labelBoxClass = $derived(
		node.labelSide === 'above' ? 'bottom-full mb-2 flex-col-reverse' : 'top-full mt-2'
	);

	/** Node box treatment: accent ring + tint + soft glow while power moves. The
	 *  glow's strength is the node's share of the plant, so the box brightens and
	 *  dims with real load — riding the box-shadow transition already on the box
	 *  rather than a halo element of its own. */
	const circleStyle = $derived.by(() => {
		const border = hasSoc ? 'transparent' : active ? node.accent : 'var(--border)';
		if (!active) return `border-color:${border};background:var(--background)`;
		return [
			`border-color:${border}`,
			`background:color-mix(in oklab, ${node.accent} 10%, var(--background))`,
			`box-shadow:0 0 34px -6px ${nodeGlow(node.accent, share)}`
		].join(';');
	});
</script>

<div
	class="absolute -translate-x-1/2 -translate-y-1/2 {fadeTransition}"
	style={`left:${node.at.x * 100}%;top:${node.at.y * 100}%`}
	class:opacity-70={!active}
>
	{#snippet box()}
		<div
			class="power-node-box flex size-full flex-col items-center justify-center border-2 leading-none {boxTransition}"
			style={circleStyle}
		>
			<Icon class={iconClass} weight="duotone" style={`color:${iconColor}`} />
			<SocReadout soc={socLabel} />
		</div>
		<SocGauge soc={ringSoc} />
	{/snippet}

	{#if detail}
		<NodeDetailDialog {detail} triggerClass={`${BOX_CLASS} cursor-pointer`}>
			{@render box()}
		</NodeDetailDialog>
	{:else}
		<div class={BOX_CLASS}>{@render box()}</div>
	{/if}
	<div
		class={`absolute left-1/2 flex w-24 -translate-x-1/2 flex-col items-center gap-0.5 leading-tight 2xl:w-32 ${labelBoxClass}`}
	>
		<span
			class="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs 2xl:text-sm"
		>
			{node.label}
		</span>
		<span
			class="flex items-center gap-0.5 text-sm font-semibold tabular-nums sm:text-base 2xl:text-xl"
		>
			{#if node.value === undefined}
				—
			{:else}
				<AnimatedNumber value={Math.abs(node.value)} unit="W" {intervalMs} />
			{/if}
			<span class="text-[0.6rem] font-normal text-muted-foreground 2xl:text-xs">W</span>
		</span>
		<span
			class={`flex items-center gap-0.5 text-[0.6rem] uppercase tracking-wide 2xl:text-xs ${node.color}`}
		>
			{#if FlowIcon}
				<FlowIcon class="size-2.5" />
			{/if}
			{node.state}
		</span>
	</div>
</div>
