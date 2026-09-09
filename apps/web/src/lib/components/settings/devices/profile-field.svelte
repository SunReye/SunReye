<script lang="ts">
	import CaretDown from 'phosphor-svelte/lib/CaretDown';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { Label } from '$lib/components/ui/label';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import * as m from '$lib/paraglide/messages';
	import ExternalProfilesManager from '../external-profiles-manager.svelte';
	import type { RegisteredProfile } from '../profile-types';
	import { type Refusal, profileGroups } from './add-device-logic';
	import type { AddDeviceForm } from './device-types';
	import FieldProblem from './field-problem.svelte';

	// Step 4: the profile that speaks to the device. The registered ones as an
	// optgroup select; beneath it the EXISTING browser, never a second picker —
	// a download lands in the select above through `onInstalled`.
	let {
		form = $bindable(),
		registered,
		refusal,
		onInstalled
	}: {
		form: AddDeviceForm;
		registered: RegisteredProfile[];
		refusal: Refusal | null;
		onInstalled: (id: string) => void;
	} = $props();

	const groups = $derived(profileGroups(registered, m.badge_builtin()));
</script>

<div class="flex flex-col gap-1.5">
	<Label for="device-profile">{m.devices_field_profile()}</Label>
	<NativeSelect.Root id="device-profile" class="w-full" bind:value={form.profileId}>
		<NativeSelect.Option value="" disabled>{m.devices_profile_none()}</NativeSelect.Option>
		{#each groups as group (group.manufacturer)}
			<NativeSelect.OptGroup label={group.manufacturer}>
				{#each group.options as option (option.value)}
					<NativeSelect.Option value={option.value}>{option.label}</NativeSelect.Option>
				{/each}
			</NativeSelect.OptGroup>
		{/each}
	</NativeSelect.Root>
	<FieldProblem field="profileId" {refusal} />
</div>

<Collapsible.Root>
	<Collapsible.Trigger class="group flex h-9 w-full items-center gap-2 text-left text-sm font-medium sm:h-8">
		<CaretDown class="size-4 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
		{m.devices_profile_download_more()}
	</Collapsible.Trigger>
	<Collapsible.Content>
		<div class="pt-2">
			<ExternalProfilesManager {onInstalled} />
		</div>
	</Collapsible.Content>
</Collapsible.Root>
