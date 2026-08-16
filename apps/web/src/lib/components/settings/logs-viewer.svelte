<script lang="ts">
	import { api } from '$lib/api';
	import { downloadText } from '$lib/utils';
	import { logs } from '$lib/logs/store.svelte';
	import { LEVELS } from './log-levels';
	import LogsLines from './logs-lines.svelte';
	import LogsToolbar from './logs-toolbar.svelte';
	import OptionSelect from './option-select.svelte';
	import SettingsSection from './settings-section.svelte';
	import * as m from '$lib/paraglide/messages';

	// Lease the `logs` topic on the app's one socket while this panel is mounted;
	// the disposer gives the topic back, leaving the connection alone.
	$effect(() => logs.lease());

	// Client-side view filters — the stream (and the export of what's on screen)
	// always carries every line; these only narrow what is rendered.
	let levelFilter = $state('all');
	let sourceFilter = $state('all');

	const levelItems = [
		{ value: 'all', label: m.logs_all_levels() },
		...LEVELS.map((l) => ({ value: l, label: l }))
	];

	// Sources observed in the buffer; keep a vanished selection (e.g. after
	// Clear) listed so the trigger doesn't fall back to the placeholder.
	const sourceItems = $derived.by(() => {
		const seen = new Set(logs.lines.map((l) => l.category));
		if (sourceFilter !== 'all') seen.add(sourceFilter);
		return [
			{ value: 'all', label: m.logs_all_sources() },
			...[...seen].sort().map((c) => ({ value: c, label: c }))
		];
	});

	const filtered = $derived(
		logs.lines.filter(
			(l) =>
				(levelFilter === 'all' || l.level === levelFilter) &&
				(sourceFilter === 'all' || l.category === sourceFilter)
		)
	);

	// Server-side level (what the server emits at all) — persisted and
	// hot-applied over /api/settings/logging, unlike the view filters above
	// which only narrow what this panel renders.
	let serverLevel = $state<string | null | undefined>(undefined); // undefined = not loaded yet
	let serverDefault = $state('info');

	$effect(() => {
		void api.api.settings.logging.get().then(({ data }) => {
			if (!data) return;
			serverLevel = data.level;
			serverDefault = data.default;
		});
	});

	const serverLevelValue = $derived(serverLevel ?? 'default');
	const serverLevelItems = $derived([
		{ value: 'default', label: `${m.logs_level_default()} (${serverDefault})` },
		...LEVELS.map((l) => ({ value: l, label: l }))
	]);

	async function changeServerLevel(v: string): Promise<void> {
		const { data } = await api.api.settings.logging.put({ level: v === 'default' ? null : v });
		if (!data) return;
		serverLevel = data.level;
		serverDefault = data.default;
	}

	function exportLogs(): void {
		// Exports the filtered view — what you see is what you save.
		const text =
			filtered
				.map(
					(l) =>
						`${new Date(l.time).toISOString()} ${l.level.toUpperCase().padEnd(7)} ${l.category} ${l.message}`
				)
				.join('\n') + '\n';
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		downloadText(`sunreye-logs-${stamp}.txt`, text);
	}
</script>

<SettingsSection title={m.logs_title()}>
	{#snippet actions()}
		<LogsToolbar exportDisabled={filtered.length === 0} onexport={exportLogs} />
	{/snippet}

	<p class="text-sm text-muted-foreground">{m.logs_desc()}</p>

	<div class="flex flex-wrap items-center gap-2">
		<OptionSelect
			value={levelFilter}
			items={levelItems}
			onchange={(v) => (levelFilter = v)}
			triggerClass="h-8 w-36 text-xs"
		/>
		<OptionSelect
			value={sourceFilter}
			items={sourceItems}
			onchange={(v) => (sourceFilter = v)}
			triggerClass="h-8 w-48 text-xs"
		/>
		{#if serverLevel !== undefined}
			<div class="ml-auto flex items-center gap-2">
				<span class="text-xs text-muted-foreground">{m.logs_server_level()}</span>
				<OptionSelect
					value={serverLevelValue}
					items={serverLevelItems}
					onchange={(v) => void changeServerLevel(v)}
					triggerClass="h-8 w-36 text-xs"
				/>
			</div>
		{/if}
	</div>

	<LogsLines lines={filtered} total={logs.lines.length} />
</SettingsSection>
