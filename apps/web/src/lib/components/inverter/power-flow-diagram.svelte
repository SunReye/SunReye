<script lang="ts">
	import CpuIcon from 'phosphor-svelte/lib/Cpu';
	import GaugeIcon from 'phosphor-svelte/lib/Gauge';
	import type { CanonicalRole } from '$lib/inverter/types';
	import AnimatedNumber from './animated-number.svelte';
	import PowerFlowNode from './power-flow-node.svelte';
	import { inverter } from '$lib/inverter/store.svelte';
	import { evcc } from '$lib/evcc/store.svelte';
	import * as msg from '$lib/paraglide/messages';
	import {
		buildPowerGraph,
		type ChargerDatum,
		type Flow,
		type Pt
	} from '$lib/inverter/power-graph';

	function power(role: CanonicalRole, index?: number): number | undefined {
		const m = inverter.byRole(role, index);
		return m ? inverter.value(m.key) : undefined;
	}

	// Presence follows *visible* metrics: byRole is filtered by Settings → Sensors,
	// so a hidden group or PV string drops its node/segment (not just its value).
	function has(role: CanonicalRole, index?: number): boolean {
		return inverter.byRole(role, index) !== undefined;
	}

	const caps = $derived(inverter.capabilities);

	// Computed metrics shown on the hub itself: self-consumption (conversion
	// losses + standby draw) and the share of drawn power that reaches the load.
	const selfUse = $derived(power('inverter.power'));
	const efficiency = $derived(power('inverter.efficiency'));

	// Battery state-of-charge (0..100) drives the square gauge on the battery node.
	const batterySoc = $derived.by(() => {
		const m = inverter.byRole('battery.soc');
		const v = m ? inverter.value(m.key) : undefined;
		return v === undefined ? undefined : Math.min(100, Math.max(0, v));
	});

	// EV charger (external EVCC): lease the store's live stream while the diagram
	// is mounted; the node appears only while EVCC is reachable with loadpoints.
	$effect(() => evcc.connect());
	const charger = $derived.by<ChargerDatum | undefined>(() => {
		if (!evcc.active) return undefined;
		const lps = evcc.loadpoints;
		// One vehicle → its SoC rings the node; several → no single truthful value.
		const soc = lps.length === 1 ? (lps[0].vehicleSoc ?? undefined) : undefined;
		return {
			power: evcc.chargePower,
			...(soc === undefined ? {} : { soc }),
			connected: lps.some((lp) => lp.connected),
			charging: lps.some((lp) => lp.charging),
			subtractFromHome: evcc.state?.subtractFromHome ?? false
		};
	});
	const vehicleSoc = $derived(charger?.soc);

	// The hero's aspect ratio picks the layout: tall boxes (phones) stack the
	// diagram, wide ones (tablets/walls) fan it out.
	let ow = $state(0);
	let oh = $state(0);
	const orientation = $derived(ow > 0 && oh > 0 && ow / oh < 1.1 ? 'portrait' : 'landscape');

	// Graph anchors are fractions of a *safe box* inset from the hero by one
	// caption stack on each side that carries text (see power-graph.ts), so node
	// captions can never clip however short the hero gets. Connector paths render
	// in real pixels, so the safe box's rendered size is bound separately.
	let w = $state(0);
	let h = $state(0);
	const INSETS: Record<string, string> = {
		portrait: 'inset-x-12 top-22 bottom-22 sm:top-24 sm:bottom-24 2xl:inset-x-16 2xl:top-30 2xl:bottom-30',
		landscape: 'inset-x-12 top-10 bottom-22 sm:bottom-24 2xl:inset-x-16 2xl:top-12 2xl:bottom-30'
	};

	const graph = $derived.by(() => buildPowerGraph(caps, power, orientation, has, charger));

	type Line = { id: string; flow: Flow; color: string; dur: number; d: string };

	/** Segment pts → SVG path: 2 pts line, 3 quadratic, 4 cubic (see power-graph). */
	function toPath(px: Pt[]): string {
		const c = px.map((p) => `${p.x} ${p.y}`);
		if (px.length === 4) return `M ${c[0]} C ${c[1]}, ${c[2]}, ${c[3]}`;
		if (px.length === 3) return `M ${c[0]} Q ${c[1]}, ${c[2]}`;
		return `M ${c[0]} L ${c[1]}`;
	}

	const lines = $derived.by<Line[]>(() => {
		if (w === 0 || h === 0) return [];
		return graph.segments.map((s) => {
			const px = s.pts.map((p) => ({ x: p.x * w, y: p.y * h }));
			return {
				id: s.id,
				flow: s.flow,
				color: s.color,
				dur: flowDuration(s.value),
				d: toPath(px)
			};
		});
	});

	/** Map magnitude → dash travel time (s). More watts = faster stream.
	 *  Quantized to coarse steps: changing a CSS animation-duration mid-flight
	 *  remaps the elapsed time and makes the dots visibly jump, so with a 1 Hz
	 *  live feed a continuous mapping stutters every sample. Steps keep the
	 *  duration stable until the power moves materially. */
	function flowDuration(watts: number | undefined): number {
		const a = Math.abs(watts ?? 0);
		const ms = 2600 / (1 + a / 130);
		const stepped = Math.round(ms / 200) * 200;
		return Math.min(2600, Math.max(400, stepped)) / 1000;
	}
</script>

<div class="relative h-full w-full" bind:clientWidth={ow} bind:clientHeight={oh}>
	<!-- Soft ambience centred on the hub — gives the wall display depth without
	     competing with the flow lines. -->
	<div
		class="pointer-events-none absolute inset-0"
		style={`background:radial-gradient(60% 55% at 50% ${graph.hub.y * 100}%, color-mix(in oklab, var(--primary) 8%, transparent), transparent 75%)`}
	></div>

	<!-- Safe box: everything anchors inside these insets. -->
	<div class={`absolute ${INSETS[orientation]}`}>
	<div class="relative h-full w-full" bind:clientWidth={w} bind:clientHeight={h}>
	{#if w > 0 && h > 0}
		<svg class="absolute inset-0" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
			<!-- Static dotted rails first (all segments) so a later segment's idle rail
			     never overpaints an earlier segment's coloured flow where routes cross. -->
			{#each lines as l (l.id)}
				<path
					class="text-border"
					d={l.d}
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-dasharray="0.1 8"
				/>
			{/each}
			<!-- Travelling energy dots on top. -->
			{#each lines as l (`flow-${l.id}`)}
				{#if l.flow !== 'idle'}
					<path
						class={`flow-line ${l.flow === 'in' ? 'flow-in' : 'flow-out'} ${l.color}`}
						d={l.d}
						fill="none"
						stroke="currentColor"
						stroke-width="4"
						stroke-linecap="round"
						stroke-dasharray="0.1 13.9"
						style={`animation-duration:${l.dur}s`}
					/>
				{/if}
			{/each}
		</svg>
	{/if}

	<!-- Inverter hub. Only the box is centred on the anchor; the metric pill
	     floats above it on a translucent backdrop so connector rails can pass
	     underneath without colliding with text. -->
	<div
		class="absolute -translate-x-1/2 -translate-y-1/2"
		style={`left:${graph.hub.x * 100}%;top:${graph.hub.y * 100}%`}
	>
		{#if (efficiency !== undefined && efficiency > 0) || selfUse !== undefined}
			<div
				class="absolute bottom-full left-1/2 mb-2.5 flex -translate-x-1/2 justify-center gap-4 rounded-xl border border-border/60 bg-background/85 px-3 py-1.5 leading-tight backdrop-blur-[2px]"
			>
				{#if efficiency !== undefined && efficiency > 0}
					<div class="flex flex-col items-center whitespace-nowrap">
						<span
							class="flex items-center gap-0.5 text-sm font-semibold tabular-nums text-primary 2xl:text-base"
						>
							<GaugeIcon class="size-3" weight="duotone" />
							<AnimatedNumber value={efficiency} unit="%" />%
						</span>
						<span class="text-[0.6rem] uppercase tracking-wide text-muted-foreground">{msg.flow_efficiency()}</span>
					</div>
				{/if}
				{#if selfUse !== undefined}
					<div class="flex flex-col items-center whitespace-nowrap">
						<span class="text-sm font-medium tabular-nums 2xl:text-base">
							<AnimatedNumber value={Math.abs(selfUse)} unit="W" /><span
								class="ml-0.5 text-[0.6rem] font-normal text-muted-foreground">W</span
							>
						</span>
						<span class="text-[0.6rem] uppercase tracking-wide text-muted-foreground">{msg.flow_self_use()}</span>
					</div>
				{/if}
			</div>
		{/if}
		<div
			class="relative flex size-14 items-center justify-center border-2 border-primary bg-background sm:size-16 2xl:size-20"
			style="box-shadow:0 0 40px -8px color-mix(in oklab, var(--primary) 55%, transparent)"
		>
			<span class="hub-ring absolute -inset-1 border border-primary/50"></span>
			<CpuIcon class="size-7 text-primary sm:size-8 2xl:size-10" weight="duotone" />
		</div>
	</div>

	{#each graph.nodes as n (n.id)}
		<PowerFlowNode
			node={n}
			soc={n.kind === 'battery' ? batterySoc : n.kind === 'charger' ? vehicleSoc : undefined}
		/>
	{/each}
	</div>
	</div>
</div>

<style>
	.flow-line {
		filter: drop-shadow(0 0 5px currentColor);
	}
	.flow-in {
		animation: flow-in linear infinite;
	}
	.flow-out {
		animation: flow-out linear infinite;
	}
	.hub-ring {
		animation: hub-pulse 2.6s ease-in-out infinite;
	}
	/* One dash period (0.1 + 13.9) per keyframe cycle for a seamless loop. */
	@keyframes flow-in {
		to {
			stroke-dashoffset: -14;
		}
	}
	@keyframes flow-out {
		to {
			stroke-dashoffset: 14;
		}
	}
	@keyframes hub-pulse {
		0%,
		100% {
			opacity: 0.35;
			transform: scale(1);
		}
		50% {
			opacity: 0.75;
			transform: scale(1.12);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.flow-in,
		.flow-out,
		.hub-ring {
			animation: none;
		}
	}
</style>
