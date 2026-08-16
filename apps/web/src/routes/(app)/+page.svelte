<script lang="ts">
	import PowerFlow from '$lib/components/inverter/power-flow-diagram.svelte';
	import WeatherTile from '$lib/components/inverter/weather-tile.svelte';
	import DailyEnergy from '$lib/components/inverter/daily-energy.svelte';
	import EvChargerCard from '$lib/components/inverter/ev-charger-card.svelte';
	import { setPageHeader } from '$lib/page-header.svelte';
	import { SHELL_GAP, SHELL_PAD } from '$lib/layout/tokens';
	import * as m from '$lib/paraglide/messages';

	$effect(() => setPageHeader(m.nav_overview()));
</script>

<!--
	Kiosk overview — the most important live values at a glance. The power-flow
	hero adapts its schematic to its box's aspect ratio (stacked on phones,
	fanned out on wide boxes). On lg+ (tablets, desktops, wall displays) the page
	pins to the full viewport height and never scrolls, in two columns: the
	portrait hero on the LEFT, weather + daily-energy tiles stacked on the RIGHT.
	The left column is held to ~53% of the width (proportional split, not a fixed
	right width) so its full-height box stays taller than it is wide at every
	desktop size — that <1.1 aspect ratio is what keeps the diagram in portrait.
	Phones scroll naturally: hero first, then weather, then the tiles. Detailed
	subsystem metrics live at /system.

	The one page in the app that is NOT a <PageShell>: the grid, the pinned
	viewport height and the overflow all have to sit on the very element the shell
	owns, and the shell deliberately accepts no `class`. It still spends the
	shell's padding and rhythm tokens, so the exception is to the container, not
	to the vocabulary. The viewport height subtracts the app header via the
	variable the layout declares — the literal `3.5rem` that used to be here was a
	copy of an `h-14` in another file, and nothing kept the two in step.
-->
<div
	class="flex flex-col {SHELL_GAP} {SHELL_PAD} lg:grid lg:h-[calc(100svh-var(--app-header-h))] lg:grid-cols-[1.15fr_1fr] lg:grid-rows-1 lg:overflow-hidden"
>
	<section class="relative h-[60svh] min-h-108 shrink-0 lg:h-full lg:min-h-0">
		<h2 class="sr-only">{m.overview_power_flow()}</h2>
		<PowerFlow />
	</section>

	<!-- Right column: weather tile then the energy cards, both at their natural
	     (compact) height, top-aligned. On tall lg viewports the leftover height
	     falls below the cards rather than stretching them. The weather tile
	     renders nothing when disabled ({#if weather ...}); the cards then simply
	     top-align on their own — no ghost gap, no centring logic needed since each
	     column owns its own width. -->
	<div class="flex flex-col gap-3 sm:gap-4 lg:min-h-0">
		<WeatherTile />
		<div class="w-full min-w-0">
			<DailyEnergy />
		</div>
		<!-- Renders nothing until EVCC is enabled, reachable, and has loadpoints. -->
		<EvChargerCard />
	</div>
</div>
