<script lang="ts">
	import type { DeviceView } from '../devices/device-types';
	import type { RegisteredProfile } from '../profile-types';
	import type { CatalogEntryView, WizardAnswers } from './add-wizard';
	import CatalogFields from './catalog-fields.svelte';
	import DeviceStep from './device-step.svelte';

	// STEP 3 — what the picked entry needs, asked in the shape its TIER calls for.
	//
	// A coded integration's settings are the scalars the catalog described, and
	// `CatalogFields` draws them from that description alone — which is why a new
	// integration is a server change and no edit here. A DEVICE is not
	// describable that way: `arrays` is an array, `battery` an object, the
	// profile is a picker, and the required `name` is not in the catalog at all.
	// Rendered generically it printed "arrays: array" over a form that could
	// never be submitted, so the profile tier gets the add dialog's own fields.
	let {
		entry,
		answers = $bindable(),
		devices,
		registered,
		onInstalled
	}: {
		/** Null only if step 2 were skipped, which `blockedAt` prevents — a step
		    body still cannot assume its predecessor ran. */
		entry: CatalogEntryView | null;
		answers: WizardAnswers;
		devices: DeviceView[];
		registered: RegisteredProfile[];
		onInstalled: (id: string) => void;
	} = $props();
</script>

{#if answers.via === 'profile'}
	<DeviceStep bind:form={answers.form} {devices} {registered} {onInstalled} />
{:else}
	<CatalogFields {entry} bind:values={answers.values} />
{/if}
