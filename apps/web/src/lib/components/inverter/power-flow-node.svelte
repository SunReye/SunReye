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
	import { socColor, type GraphNode, type NodeKind } from '$lib/inverter/power-graph';

	let {
		node,
		soc
	}: {
		node: GraphNode;
		/** Battery/vehicle state-of-charge (0..100); renders the square gauge when set. */
		soc?: number;
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
	const hasSoc = $derived((node.kind === 'battery' || node.kind === 'charger') && soc !== undefined);

	// SOC ring geometry: a square gauge traced just inside the node box (viewBox
	// 56×56, scaled with the box) so the battery keeps the same footprint as every
	// other node. Perimeter drives the dash fill like a circumference would.
	const SOC_INSET = 2;
	const SOC_SIZE = 56 - SOC_INSET * 2;
	const SOC_PERIMETER = SOC_SIZE * 4;

	/** Node box treatment: accent ring + tint + soft glow while power moves. */
	const circleStyle = $derived.by(() => {
		const border = hasSoc ? 'transparent' : active ? node.accent : 'var(--border)';
		if (!active) return `border-color:${border};background:var(--background)`;
		return [
			`border-color:${border}`,
			`background:color-mix(in oklab, ${node.accent} 10%, var(--background))`,
			`box-shadow:0 0 34px -6px color-mix(in oklab, ${node.accent} 60%, transparent)`
		].join(';');
	});
</script>

<div
	class="absolute -translate-x-1/2 -translate-y-1/2 transition-opacity duration-500"
	style={`left:${node.at.x * 100}%;top:${node.at.y * 100}%`}
	class:opacity-70={!active}
>
	<div class="relative size-14 sm:size-16 2xl:size-20">
		<div
			class="flex size-full items-center justify-center border-2 transition-[box-shadow,border-color,background] duration-500"
			style={circleStyle}
		>
			<Icon
				class="size-7 sm:size-8 2xl:size-10"
				weight="duotone"
				style={`color:${active ? node.accent : 'var(--muted-foreground)'}`}
			/>
		</div>
		{#if hasSoc && soc !== undefined}
			<!-- Square SOC gauge inset to the box edge so the battery keeps the same
			     footprint as the other nodes. -->
			<svg class="absolute inset-0 size-full" viewBox="0 0 56 56" aria-hidden="true">
				<rect
					class="text-border"
					x={SOC_INSET}
					y={SOC_INSET}
					width={SOC_SIZE}
					height={SOC_SIZE}
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
				/>
				<rect
					x={SOC_INSET}
					y={SOC_INSET}
					width={SOC_SIZE}
					height={SOC_SIZE}
					fill="none"
					stroke={socColor(soc)}
					stroke-width="2.5"
					stroke-dasharray={SOC_PERIMETER}
					stroke-dashoffset={SOC_PERIMETER * (1 - soc / 100)}
					style="transition:stroke-dashoffset 500ms linear, stroke 500ms linear"
				/>
			</svg>
			<span
				class="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 border border-border bg-background px-1.5 text-[0.62rem] font-semibold tabular-nums leading-tight"
				style={`color:${socColor(soc)}`}
			>
				{Math.round(soc)}%
			</span>
		{/if}
	</div>
	<div
		class={`absolute left-1/2 flex w-24 -translate-x-1/2 flex-col items-center gap-0.5 leading-tight 2xl:w-32 ${
			node.labelSide === 'above' ? 'bottom-full mb-2 flex-col-reverse' : 'top-full mt-2'
		}`}
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
				<AnimatedNumber value={Math.abs(node.value)} unit="W" />
			{/if}
			<span class="text-[0.6rem] font-normal text-muted-foreground 2xl:text-xs">W</span>
		</span>
		<span
			class={`flex items-center gap-0.5 text-[0.6rem] uppercase tracking-wide 2xl:text-xs ${node.color}`}
		>
			{#if node.flow === 'in'}
				<ArrowDown class="size-2.5" />
			{:else if node.flow === 'out'}
				<ArrowUp class="size-2.5" />
			{/if}
			{node.state}
		</span>
	</div>
</div>
