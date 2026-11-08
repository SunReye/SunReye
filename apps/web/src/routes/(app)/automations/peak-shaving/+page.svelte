<script lang="ts">
	import { fly } from 'svelte/transition';
	import { prefersReducedMotion } from 'svelte/motion';
	import CaretLeftIcon from 'phosphor-svelte/lib/CaretLeft';
	import PeakShavingStatus from '$lib/components/automations/peak-shaving-status.svelte';
	import DecisionCharts from '$lib/components/automations/decision-charts.svelte';
	import DecisionPlan from '$lib/components/automations/decision-plan.svelte';
	import LiveIndicator from '$lib/components/automations/live-indicator.svelte';
	import { automationStream } from '$lib/components/automations/stream.svelte';
	import { bus } from '$lib/ws/bus.svelte';
	import { resolve } from '$lib/resolve';
	import { setPageHeader } from '$lib/page-header.svelte';
	import PageShell from '$lib/components/layout/page-shell.svelte';
	import * as m from '$lib/paraglide/messages';

	// One topic lease feeds the page: the status card and the plan projection
	// update the moment the engine ticks. The socket itself is the app shell's.
	//
	// The decision history is not on that topic any more. The optimizer is a
	// device, so what it decided is read from `/api/history/rollup` under the
	// `optimizer` slug by the section that plots it — which is why the frame
	// carries a tick STAMP down instead of a ring of points.
	$effect(() => automationStream.lease());
	const status = $derived(automationStream.status);

	// Section entrances: a small staggered rise, disabled for reduced motion.
	const rise = (i: number) =>
		prefersReducedMotion.current
			? { y: 0, duration: 0 }
			: { y: 8, duration: 200, delay: i * 50 };

	$effect(() => setPageHeader(m.peak_shaving_title(), m.automations_subtitle()));
</script>

<PageShell width="wide">
	<!-- The back link is not a page control, so it is not `toolbar` — but it does
	     belong on the toolbar's row rather than under it: as a child of `children`
	     it cost a second vertical row and put "where I came from" below the live
	     status. `lead` is the left end of that one row. -->
	{#snippet lead()}
		<a
			href={resolve('/automations')}
			class="flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
		>
			<CaretLeftIcon class="size-4" />
			{m.automations_back()}
		</a>
	{/snippet}

	{#snippet toolbar()}
		<LiveIndicator
			connected={bus.connected}
			tickArrivedAt={automationStream.tickArrivedAt}
			tickMs={automationStream.tickMs}
		/>
	{/snippet}

	<div class="flex min-w-0 flex-col gap-6">
		<div in:fly={rise(0)}>
			<PeakShavingStatus {status} />
		</div>
		<div in:fly={rise(1)}>
			<DecisionPlan plans={automationStream.plan} loaded={automationStream.loaded} />
		</div>
		<div in:fly={rise(2)}>
			<DecisionCharts loaded={automationStream.loaded} lastTickAt={automationStream.lastTickAt} />
		</div>
	</div>
</PageShell>
