<script lang="ts">
	import CpuIcon from 'phosphor-svelte/lib/Cpu';
	import GaugeIcon from 'phosphor-svelte/lib/Gauge';
	import type { CanonicalRole } from '$lib/inverter/types';
	import PowerFlowNode from './power-flow-node.svelte';
	import PowerFlowRails, { type RailLine } from './_shared/power-flow-rails.svelte';
	import HubMetrics from './_shared/hub-metrics.svelte';
	import { inverter } from '$lib/inverter/store.svelte';
	import { evcc, type EvccLoadpoint } from '$lib/evcc/store.svelte';
	import {
		buildPowerGraph,
		type ChargerDatum,
		type NodeKind,
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
	/** One vehicle → its SoC rings the node; several → no single truthful value. */
	function singleVehicleSoc(lps: EvccLoadpoint[]): number | undefined {
		if (lps.length !== 1) return undefined;
		return lps[0].vehicleSoc ?? undefined;
	}
	const subtractsFromHome = () => evcc.state?.subtractFromHome ?? false;

	const charger = $derived.by<ChargerDatum | undefined>(() => {
		if (!evcc.active) return undefined;
		const lps = evcc.loadpoints;
		const soc = singleVehicleSoc(lps);
		return {
			power: evcc.chargePower,
			...(soc === undefined ? {} : { soc }),
			connected: lps.some((lp) => lp.connected),
			charging: lps.some((lp) => lp.charging),
			subtractFromHome: subtractsFromHome()
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

	/** Segment pts → SVG path: 2 pts line, 3 quadratic, 4 cubic (see power-graph). */
	function toPath(px: Pt[]): string {
		const c = px.map((p) => `${p.x} ${p.y}`);
		if (px.length === 4) return `M ${c[0]} C ${c[1]}, ${c[2]}, ${c[3]}`;
		if (px.length === 3) return `M ${c[0]} Q ${c[1]}, ${c[2]}`;
		return `M ${c[0]} L ${c[1]}`;
	}

	// Anchors are fractions; the rails need real pixels, so hold off until the safe
	// box has been measured.
	const measured = $derived(w > 0 && h > 0);

	const lines = $derived.by<RailLine[]>(() => {
		if (!measured) return [];
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
	const flowing = $derived(lines.filter((l) => l.flow !== 'idle'));

	/** Only the battery and the EV charger ring a state-of-charge. */
	const socFor = (kind: NodeKind) =>
		kind === 'battery' ? batterySoc : kind === 'charger' ? vehicleSoc : undefined;

	// Per-node extras the diagram supplies, resolved up front so the markup below
	// stays branch-free.
	const renderNodes = $derived(
		graph.nodes.map((n) => ({
			node: n,
			soc: socFor(n.kind),
			// The EVCC feed has its own cadence; the rest follow the inverter's.
			intervalMs: n.kind === 'charger' ? evcc.cadenceMs : undefined
		}))
	);

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
	{#if measured}
		<PowerFlowRails {lines} {flowing} width={w} height={h} />
	{/if}

	<!-- Inverter hub. Only the box is centred on the anchor; the metric pill
	     floats above it on a translucent backdrop so connector rails can pass
	     underneath without colliding with text. -->
	<div
		class="absolute -translate-x-1/2 -translate-y-1/2"
		style={`left:${graph.hub.x * 100}%;top:${graph.hub.y * 100}%`}
	>
		<HubMetrics {efficiency} {selfUse} />
		<div
			class="relative flex size-14 items-center justify-center border-2 border-primary bg-background sm:size-16 2xl:size-20"
			style="box-shadow:0 0 40px -8px color-mix(in oklab, var(--primary) 55%, transparent)"
		>
			<span class="hub-ring absolute -inset-1 border border-primary/50"></span>
			<CpuIcon class="size-7 text-primary sm:size-8 2xl:size-10" weight="duotone" />
		</div>
	</div>

	{#each renderNodes as r (r.node.id)}
		<PowerFlowNode {...r} />
	{/each}
	</div>
	</div>
</div>

<style>
	.hub-ring {
		animation: hub-pulse 2.6s ease-in-out infinite;
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
		.hub-ring {
			animation: none;
		}
	}
</style>
