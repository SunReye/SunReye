<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as m from '$lib/paraglide/messages';
	import { SLUG_MAX } from '@SunReye/inverter-core/slug';
	import { apiErrorText } from '../api-error';
	import { type Refusal, describeRefusal, nameProblem } from './add-device-logic';
	import { renameBlock } from './rename-logic';
	import DialogShell from './device-dialog-shell.svelte';
	import type { DeviceView } from './device-types';
	import FieldProblem from './field-problem.svelte';

	// The NAME-ONLY dialog, for a row whose addressing is not the operator's to
	// change: an EVCC loadpoint, the optimizer. The addressing dialog would ask
	// for a gateway, a unit id and a profile, and the server refuses all three on
	// these rows (#219 narrowed its refusal to exactly that). What is left is the
	// label — and a row nobody can label is why this dialog exists.
	//
	// The slug is NOT previewed here, unlike the add dialog: it was frozen when
	// the integration created the row, and a rename does not move it. Showing one
	// would promise the URL changes with the name.
	let {
		device = $bindable(null),
		onSaved
	}: {
		/** The row being renamed, or null when the dialog is closed. */
		device?: DeviceView | null;
		onSaved: () => void;
	} = $props();

	let name = $state('');
	let submitting = $state(false);
	let refusal = $state<Refusal | null>(null);
	/** The row the field was last seeded from, so re-opening reseeds exactly once. */
	let seeded: number | null = null;

	$effect(() => {
		if (device === null) {
			seeded = null;
			return;
		}
		if (seeded === device.id) return;
		seeded = device.id;
		name = device.name;
		refusal = null;
	});

	const trimmed = $derived(name.trim());
	const problem = $derived(trimmed === '' ? null : nameProblem(name));
	// Why Save is refused, decided in `./rename-logic.ts`.
	const blocked = $derived(
		renameBlock({ typed: name, current: device?.name ?? null, submitting }) !== null
	);

	function close() {
		device = null;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const target = device;
		if (blocked || target === null) return;
		submitting = true;
		refusal = null;
		refusal = await rename(target, trimmed);
		submitting = false;
	}

	/** The request, and what it leaves behind: a refusal to show, or nothing. */
	async function rename(target: DeviceView, to: string): Promise<Refusal | null> {
		const result = await api.api.devices({ id: String(target.id) }).patch({ name: to });
		if (result.data) return saved(result.data as DeviceView);
		const error = result.error?.value;
		return describeRefusal(error, apiErrorText(error, m.error_unknown()));
	}

	function saved(device: DeviceView): null {
		toast.success(m.devices_toast_updated({ name: device.name }));
		close();
		onSaved();
		return null;
	}

</script>

<DialogShell
	open={device !== null}
	title={m.devices_rename_dialog_title()}
	description={m.devices_rename_dialog_description()}
	onClose={close}
	onsubmit={submit}
>
	<div class="flex flex-col gap-1.5">
		<Label for="device-rename">{m.devices_field_name()}</Label>
		<Input id="device-rename" bind:value={name} maxlength={SLUG_MAX} autocomplete="off" />
		<FieldProblem
			field="name"
			{refusal}
			hint={problem ? m.devices_name_invalid({ max: SLUG_MAX }) : null}
			hintIsProblem={problem !== null}
		/>
	</div>
	<div class="flex justify-end gap-2">
		<Button type="button" variant="ghost" onclick={close}>{m.action_cancel()}</Button>
		<Button type="submit" disabled={blocked}>{m.action_save()}</Button>
	</div>
</DialogShell>
