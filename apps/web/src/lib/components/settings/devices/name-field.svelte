<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { SLUG_MAX, slugify } from '$lib/slug';
	import * as m from '$lib/paraglide/messages';
	import { type Refusal, nameProblem } from './add-device-logic';
	import type { AddDeviceForm } from './device-types';
	import FieldProblem from './field-problem.svelte';

	// Step 3: the name, and the slug it freezes into — shown live because this
	// is the only moment it can be corrected (see `$lib/slug`).
	let { form = $bindable(), refusal }: { form: AddDeviceForm; refusal: Refusal | null } =
		$props();

	const trimmed = $derived(form.name.trim());
	const problem = $derived(trimmed === '' ? null : nameProblem(form.name));
	const slug = $derived(slugify(trimmed));
	const hint = $derived(
		problem ? m.devices_name_invalid({ max: SLUG_MAX }) : slug ? m.devices_slug_preview({ slug }) : null
	);
</script>

<div class="flex flex-col gap-1.5">
	<Label for="device-name">{m.devices_field_name()}</Label>
	<Input id="device-name" bind:value={form.name} maxlength={SLUG_MAX} autocomplete="off" />
	<FieldProblem field="name" {refusal} {hint} hintIsProblem={problem !== null} />
</div>
