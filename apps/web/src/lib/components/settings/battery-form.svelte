<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import { Button } from '$lib/components/ui/button';
	import BatteryNameplateField from './battery-nameplate-field.svelte';
	import Section from '$lib/components/layout/section.svelte';
	import ActionBar from './action-bar.svelte';
	import { parseNum } from '$lib/parse-num';
	import { useAppSession } from '$lib/session';
	import * as m from '$lib/paraglide/messages';

	// The pack's rated capacity, stated rather than measured. It is what battery
	// health is compared against; without it the statistics page falls back to
	// this system's own earliest measurements, which tracks degradation but
	// cannot say how far the pack already was from factory. Optional on purpose —
	// blank is a valid, working state, not an unfinished one.
	const session = useAppSession();
	const isAdmin = $derived($session.data?.user.role === 'admin');

	let nameplateText = $state('');
	let saving = $state(false);

	onMount(async () => {
		const { data } = await api.api.battery.config.get();
		nameplateText = data?.nameplateKwh == null ? '' : String(data.nameplateKwh);
	});

	// Blank clears the nameplate rather than failing: "I do not know it" is an
	// answer the health figure handles, and forcing a number would make people
	// invent one.
	const parsed = $derived(nameplateText.trim() === '' ? null : parseNum(nameplateText));
	const invalid = $derived(parsed !== null && !(parsed > 0 && parsed <= 10_000));

	async function save() {
		if (invalid) return;
		saving = true;
		const { error } = await api.api.battery.config.put({ nameplateKwh: parsed });
		saving = false;
		if (error) toast.error(m.battery_nameplate_save_failed());
		else toast.success(m.battery_nameplate_saved());
	}
</script>

<ActionBar>
	<Button size="sm" disabled={!isAdmin || saving || invalid} onclick={save}>
		{saving ? m.action_saving() : m.action_save()}
	</Button>
</ActionBar>

<Section title={m.battery_section()} caption={m.battery_section_caption()}>
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<BatteryNameplateField bind:value={nameplateText} {invalid} disabled={!isAdmin} />
	</div>
</Section>
