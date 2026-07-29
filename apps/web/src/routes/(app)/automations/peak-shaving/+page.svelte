<script lang="ts">
	import { fly } from 'svelte/transition';
	import { prefersReducedMotion } from 'svelte/motion';
	import CaretLeftIcon from 'phosphor-svelte/lib/CaretLeft';
	import PeakShavingForm from '$lib/components/automations/peak-shaving-form.svelte';
	import PeakShavingStatus from '$lib/components/automations/peak-shaving-status.svelte';
	import DecisionCharts from '$lib/components/automations/decision-charts.svelte';
	import DecisionPlan from '$lib/components/automations/decision-plan.svelte';
	import LiveIndicator from '$lib/components/automations/live-indicator.svelte';
	import { automationStream } from '$lib/components/automations/stream.svelte';
	import { resolve } from '$lib/resolve';
	import { setPageHeader } from '$lib/page-header.svelte';
	import * as m from '$lib/paraglide/messages';

	// One WebSocket lease feeds everything on the page: the status card, the
	// form's blocker gating, the plan section and the decision charts all update
	// the moment the engine ticks — no polls.
	$effect(() => automationStream.connect());
	const status = $derived(automationStream.status);

	// Section entrances: a small staggered rise, disabled for reduced motion.
	const rise = (i: number) =>
		prefersReducedMotion.current
			? { y: 0, duration: 0 }
			: { y: 8, duration: 200, delay: i * 50 };

	$effect(() => setPageHeader(m.peak_shaving_title(), m.automations_subtitle()));
</script>

<div class="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 2xl:max-w-384">
	<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
		<a
			href={resolve('/automations')}
			class="flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
		>
			<CaretLeftIcon class="size-4" />
			{m.automations_back()}
		</a>
		<LiveIndicator
			connected={automationStream.connected}
			tickArrivedAt={automationStream.tickArrivedAt}
			tickMs={automationStream.tickMs}
		/>
	</div>

	<!-- Widescreen: configuration on the left, the live picture on the right;
	     below xl the sections stack in reading order. -->
	<div class="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
		<div class="flex min-w-0 flex-col gap-6">
			<div in:fly={rise(0)}>
				<PeakShavingStatus {status} />
			</div>
			<div in:fly={rise(1)}>
				<PeakShavingForm {status} />
			</div>
		</div>
		<div class="flex min-w-0 flex-col gap-6">
			<div in:fly={rise(2)}>
				<DecisionPlan
					plans={automationStream.plan}
					loaded={automationStream.loaded}
					history={automationStream.history}
				/>
			</div>
			<div in:fly={rise(3)}>
				<DecisionCharts points={automationStream.history} loaded={automationStream.loaded} />
			</div>
		</div>
	</div>
</div>
