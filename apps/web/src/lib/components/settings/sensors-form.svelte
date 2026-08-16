<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import SensorGroup from './sensor-group.svelte';
	import Section from '$lib/components/layout/section.svelte';
	import SaveBar from './save-bar.svelte';
	import { inverter } from '$lib/inverter/store.svelte';
	import type { ManifestMetric } from '$lib/inverter/types';
	import { uiPrefs, type UiPrefs } from '$lib/ui-prefs.svelte';
	import * as m from '$lib/paraglide/messages';
	import { useAppSession } from '$lib/session';

	const session = useAppSession();
	const isAdmin = $derived($session.data?.user.role === 'admin');

	// Translated names for the well-known subsystem groups; anything else falls
	// back to a title-cased version of the raw group id from the profile.
	const GROUP_LABELS: Record<string, () => string> = {
		solar: m.label_solar,
		battery: m.label_battery,
		grid: m.label_grid,
		load: m.label_load,
		generator: m.label_generator,
		inverter: m.label_inverter
	};
	const groupLabel = (id: string) => GROUP_LABELS[id]?.() ?? id.charAt(0).toUpperCase() + id.slice(1);

	// The full (unfiltered) catalog, grouped in profile order so the form lists
	// every sensor — including the ones currently hidden.
	const groups = $derived.by(() => {
		const byGroup = new Map<string, ManifestMetric[]>();
		for (const metric of inverter.allMetrics) {
			const list = byGroup.get(metric.group) ?? [];
			list.push(metric);
			byGroup.set(metric.group, list);
		}
		return [...byGroup].map(([id, metrics]) => ({ id, label: groupLabel(id), metrics }));
	});

	// Local edit buffer (arrays match the saved shape). Reassigned on every toggle
	// so the reactive reads below recompute.
	let draft = $state<UiPrefs | null>(null);
	let saving = $state(false);

	onMount(async () => {
		await uiPrefs.load();
		draft = {
			hiddenKeys: [...uiPrefs.config.hiddenKeys],
			hiddenGroups: [...uiPrefs.config.hiddenGroups]
		};
	});

	const isGroupVisible = (id: string) => !draft?.hiddenGroups.includes(id);
	const isMetricVisible = (metric: ManifestMetric) =>
		!draft?.hiddenGroups.includes(metric.group) && !draft?.hiddenKeys.includes(metric.key);

	function setGroupVisible(id: string, visible: boolean) {
		if (!draft) return;
		draft.hiddenGroups = visible
			? draft.hiddenGroups.filter((g) => g !== id)
			: [...draft.hiddenGroups.filter((g) => g !== id), id];
	}

	function setMetricVisible(key: string, visible: boolean) {
		if (!draft) return;
		draft.hiddenKeys = visible
			? draft.hiddenKeys.filter((k) => k !== key)
			: [...draft.hiddenKeys.filter((k) => k !== key), key];
	}

	async function save() {
		if (!draft) return;
		saving = true;
		const ok = await uiPrefs.save(draft);
		saving = false;
		if (ok) toast.success(m.toast_sensors_saved());
		else toast.error(m.toast_sensors_error());
	}

	const fieldsDisabled = $derived(!isAdmin || saving);
	// `null` = the catalog is ready to render.
	const message = $derived(
		!draft ? m.app_loading() : groups.length === 0 ? m.settings_sensors_empty() : null
	);
</script>

<SaveBar {isAdmin} {saving} disabled={!draft} onsave={save} />

<Section title={m.settings_sensors_title()}>
	<p class="max-w-prose text-sm text-muted-foreground">{m.settings_sensors_desc()}</p>

	{#if message !== null}
		<p class="text-sm text-muted-foreground">{message}</p>
	{:else}
		<!-- The catalog scrolls inside its own box so long profiles don't push the
		     page (and the Save action) out of reach; group headers stick to the top
		     of the box until the next group scrolls up to replace them. -->
		<div class="max-h-[60vh] overflow-y-auto rounded-md border border-border">
			{#each groups as group (group.id)}
				<SensorGroup
					label={group.label}
					metrics={group.metrics}
					visible={isGroupVisible(group.id)}
					disabled={fieldsDisabled}
					{isMetricVisible}
					onGroupChange={(v) => setGroupVisible(group.id, v)}
					onMetricChange={setMetricVisible}
				/>
			{/each}
		</div>
	{/if}
</Section>
