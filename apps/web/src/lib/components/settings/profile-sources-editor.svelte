<script lang="ts">
	import Section from '$lib/components/layout/section.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as m from '$lib/paraglide/messages';
	import RowRemoveButton from './row-remove-button.svelte';
	import type { Source, StoredSource } from './profile-types';

	let {
		sources,
		busy,
		onAdd,
		onRemove
	}: {
		sources: StoredSource[];
		busy: boolean;
		onAdd: (source: Source) => void;
		onRemove: (source: Source) => void;
	} = $props();

	let baseUrl = $state('');
	let indexPath = $state('index.json');
	let problem = $state<string | null>(null);

	// The core refuses the same cases with its own message; catching them here spares a round trip.
	function refusal(source: Source): string | null {
		if (!source.baseUrl.startsWith('https://')) return m.sources_url_invalid();
		if (sources.some((s) => s.baseUrl === source.baseUrl && s.indexPath === source.indexPath)) {
			return m.sources_already_added();
		}
		return null;
	}

	function add(event: SubmitEvent) {
		event.preventDefault();
		const source = { baseUrl: baseUrl.trim(), indexPath: indexPath.trim() };
		if (!source.baseUrl || !source.indexPath) return;
		problem = refusal(source);
		if (problem) return;
		onAdd(source);
		baseUrl = '';
	}
</script>

<Section title={m.sources_title()}>
	<ul class="flex flex-col divide-y divide-border">
		{#each sources as s (`${s.baseUrl}${s.indexPath}`)}
			<li class="flex items-center justify-between gap-3 py-2.5">
				<div class="flex min-w-0 flex-col gap-0.5">
					<span class="text-sm break-all">{s.baseUrl}</span>
					<span class="text-xs break-all text-muted-foreground">
						{s.indexPath} · {m.sources_profile_count({ count: s.profileIds.length })}
					</span>
				</div>
				<RowRemoveButton
					label={m.sources_remove_aria({ url: s.baseUrl })}
					disabled={busy}
					onclick={() => onRemove({ baseUrl: s.baseUrl, indexPath: s.indexPath })}
				/>
			</li>
		{/each}
		{#if sources.length === 0}
			<li class="py-2.5 text-sm text-muted-foreground">{m.sources_none()}</li>
		{/if}
	</ul>
	<form class="flex flex-col gap-3" onsubmit={add}>
		<div class="flex flex-col gap-3 sm:flex-row">
			<div class="flex min-w-0 flex-1 flex-col gap-1.5">
				<Label for="source-base">{m.sources_base_label()}</Label>
				<Input
					id="source-base"
					bind:value={baseUrl}
					disabled={busy}
					placeholder="https://example.org/profiles/"
					oninput={() => (problem = null)}
				/>
			</div>
			<div class="flex min-w-0 flex-col gap-1.5 sm:w-48">
				<Label for="source-index">{m.sources_index_label()}</Label>
				<Input id="source-index" bind:value={indexPath} disabled={busy} oninput={() => (problem = null)} />
			</div>
		</div>
		{#if problem}
			<p role="alert" class="text-sm text-destructive">{problem}</p>
		{/if}
		<Button type="submit" variant="outline" class="h-9 w-full sm:h-8 sm:w-auto sm:self-start" disabled={busy}>
			{m.action_add()}
		</Button>
	</form>
</Section>
