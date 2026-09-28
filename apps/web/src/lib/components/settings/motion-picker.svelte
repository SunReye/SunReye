<script lang="ts">
	// How much the dashboard animates on THIS device.
	//
	// Per-browser, like theme and language, and for a sharper reason than taste:
	// the wall tablet in the hallway and the laptop in the office read the same
	// plant and do not have the same frame budget, so an instance-wide setting
	// would be wrong for one of them. `auto` measures the device and steps down
	// when it cannot hold its frames — see `$lib/motion/tier`.
	//
	// Its own component rather than three more elements in `display-form.svelte`:
	// the hint below the select is a branch, and that form's template is already
	// at the repo's complexity ceiling.
	import { Label } from '$lib/components/ui/label';
	import Section from '$lib/components/layout/section.svelte';
	import OptionSelect from './option-select.svelte';
	import { motion } from '$lib/motion/tier.svelte';
	import { MAX_STRAIN, MOTION_SETTINGS, type MotionSetting } from '$lib/motion/tier';
	import * as m from '$lib/paraglide/messages';

	const LABELS: Record<MotionSetting, () => string> = {
		auto: m.motion_auto,
		full: m.motion_full,
		lite: m.motion_lite,
		still: m.motion_still
	};
	// Built from the type's own list, so a tier added there cannot go unofferable.
	const ITEMS = MOTION_SETTINGS.map((value) => ({ value, label: LABELS[value]() }));

	/** What `auto` has measured on this device — the only state worth a word. */
	const hint = $derived.by(() => {
		if (motion.setting !== 'auto') return '';
		if (motion.measuredStrain >= MAX_STRAIN) return m.motion_measured_still();
		if (motion.measuredStrain > 0) return m.motion_measured_lite();
		return m.motion_auto_hint();
	});
</script>

<Section title={m.settings_motion()}>
	<p class="text-sm text-muted-foreground">{m.settings_motion_desc()}</p>
	<div class="flex flex-col gap-2">
		<Label for="motion">{m.settings_motion_label()}</Label>
		<OptionSelect
			value={motion.setting}
			items={ITEMS}
			onchange={(v) => (motion.setting = v as MotionSetting)}
			triggerClass="max-w-xs"
		/>
		{#if hint}
			<p class="text-xs text-muted-foreground">{hint}</p>
		{/if}
	</div>
</Section>
