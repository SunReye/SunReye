<script lang="ts">
	import PeakShavingForm from '$lib/components/automations/peak-shaving-form.svelte';
	import PeakShavingStatus from '$lib/components/automations/peak-shaving-status.svelte';
	import { api } from '$lib/api';
	import { setPageHeader } from '$lib/page-header.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { AutomationStatusView, PeakShavingStatus as Status } from '$lib/automations';

	// One poll feeds both the status card and the form's blocker gating.
	let status = $state<Status | null>(null);

	$effect(() => {
		let stop = false;
		const tick = async () => {
			const { data } = await api.api.automations.status.get();
			if (!stop && data) status = (data as AutomationStatusView).peakShaving;
		};
		tick();
		const id = setInterval(tick, 5000);
		return () => {
			stop = true;
			clearInterval(id);
		};
	});

	$effect(() => setPageHeader(m.nav_automations(), m.automations_subtitle()));
</script>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
	<PeakShavingStatus {status} />
	<PeakShavingForm {status} />
</div>
