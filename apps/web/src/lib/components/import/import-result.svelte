<script lang="ts">
	import Section from '$lib/components/layout/section.svelte';
	import { SECTION_GAP } from '$lib/layout/tokens';
	import { Button } from '$lib/components/ui/button';
	import type { ImportReport } from '$lib/archive-import/import-client';
	import * as m from '$lib/paraglide/messages';

	let { report, onDone }: { report: ImportReport; onDone: () => void } = $props();

	const counts = $derived([
		{ label: m.import_result_raw(), rows: report.read.raw },
		{ label: m.import_result_minute(), rows: report.read.minute },
		{ label: m.import_result_hourly(), rows: report.read.hourly },
		{ label: m.import_result_daily(), rows: report.read.daily },
		{ label: m.import_result_config_log(), rows: report.read.configLog }
	]);
</script>

<Section title={m.import_result_title()}>
	<dl class="grid {SECTION_GAP} text-sm">
		{#each counts as count (count.label)}
			<div class="flex justify-between gap-4">
				<dt>{count.label}</dt>
				<dd class="tabular-nums">{count.rows}</dd>
			</div>
		{/each}
	</dl>
	{#if report.gaps.length > 0}
		<div class="flex flex-col {SECTION_GAP} text-sm">
			<h3 class="font-medium">{m.import_result_gaps()}</h3>
			<ul class="list-disc pl-5">
				{#each report.gaps as gap (`${gap.device}${gap.start}`)}
					<li class="break-all">
						{m.import_result_gap({ device: gap.device, start: gap.start, end: gap.end })}
					</li>
				{/each}
			</ul>
		</div>
	{/if}
	{#if report.conflicts > 0}
		<div class="flex flex-col {SECTION_GAP} text-sm">
			<p>{m.import_result_conflicts({ count: report.conflicts })}</p>
			{#if report.firstConflict}
				{@const first = report.firstConflict}
				<p class="break-all text-muted-foreground">
					{m.import_result_first_conflict({
						device: first.device,
						metric: first.metric,
						at: first.at,
						kept: first.kept,
						dropped: first.dropped
					})}
				</p>
			{/if}
		</div>
	{/if}
	<div>
		<Button class="h-9 sm:h-8" onclick={onDone}>{m.import_result_continue()}</Button>
	</div>
</Section>
