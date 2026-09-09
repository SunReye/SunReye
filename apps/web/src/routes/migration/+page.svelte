<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$lib/resolve';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { migration } from '$lib/migration.svelte';
	import HistoryChoice from '$lib/components/migration/history-choice.svelte';
	import IdentifierPanel from '$lib/components/migration/identifier-panel.svelte';
	import { slugify } from '$lib/slug';
	import { slugFields } from '$lib/migration-submit';
	import LabelledField from '$lib/components/migration/labelled-field.svelte';
	import * as m from '$lib/paraglide/messages';
	import { useAppSession } from '$lib/session';
	import AuthShell from '../../components/AuthShell.svelte';

	/**
	 * MIGRATION ONBOARDING: the two names the 1.2.0 -> 2.0.0 upgrade cannot invent.
	 *
	 * Deliberately NOT a wizard. A wizard is a thing an operator abandons halfway,
	 * and a half-finished migration onboarding holds Home Assistant discovery
	 * indefinitely — so it is one screen with two required fields, the derived
	 * identifiers shown live beside them, and the history decision.
	 *
	 * The identifier preview is the point of the screen. Both slugs land in every
	 * MQTT topic and every Home Assistant `unique_id` permanently, and this is the
	 * only moment they can be corrected (the server refuses afterwards —
	 * `apps/server/src/migration/onboarding-plan.ts`). Showing the consequence while
	 * it is still editable is what turns a permanent regret into one keystroke.
	 */
	const sessionQuery = useAppSession();

	// Gate, mirroring /setup: no session -> /login. The other half of the gate
	// ("nothing to confirm -> the app") needs the status, so it rides the load below.
	$effect(() => {
		if (!$sessionQuery.isPending && !$sessionQuery.data) goto(resolve('/login'));
	});
	// The two fields. Seeded from the server's pre-fill exactly ONCE, in the same
	// effect that loads it: a `$derived` here — or a re-seed on any later refresh of
	// the status — would overwrite what the operator is halfway through typing,
	// which is the one thing a pre-filled required field must never do. `loaded` is
	// a plain `let` on purpose; nothing renders it, so making it reactive would only
	// add a dependency.
	let plantName = $state('');
	let deviceName = $state('');
	let loaded = false;
	$effect(() => {
		if ($sessionQuery.isPending || !$sessionQuery.data || loaded) return;
		loaded = true;
		migration.load().then(() => {
			const current = migration.status;
			if (current === null) return;
			if (!current.onboardingRequired) {
				goto(resolve('/'));
				return;
			}
			plantName = current.plantName;
			deviceName = current.deviceName;
		});
	});

	const status = $derived(migration.status);

	// The PLANT identifier follows the plant name; the DEVICE identifier does not
	// follow the device name. The asymmetry is deliberate and it is the server's:
	//
	//  * The plant slug was derived from whatever human string the 1.2.0 settings
	//    happened to hold — a weather tile's label, else "plant". It is a name's
	//    slug already, and following the real name the operator now types is the
	//    whole point of offering this window.
	//  * The device slug is derived from the device's ROLE ("inverter"), never from
	//    the profile, precisely so a profile swap cannot move the MQTT namespace
	//    (apps/server/src/inverter/provision.ts, "SLUGS ARE FROZEN"). Letting it
	//    track a model name would re-introduce that by the front door: naming the
	//    device "SG05LP3" would silently move every topic to `…/sg05lp3`.
	//
	// Either can still be corrected by hand, which is what the fields below are for.
	// What is SHOWN is always what will be submitted — a preview that disagreed
	// would show a consequence that is not the one about to happen. See
	// `$lib/slug.ts` on why this derivation is a port and not a guess.
	let plantSlugOverride = $state<string | null>(null);
	let deviceSlugOverride = $state<string | null>(null);
	const plantSlug = $derived(plantSlugOverride ?? (slugify(plantName) || (status?.plantSlug ?? '')));
	const deviceSlug = $derived(deviceSlugOverride ?? (status?.deviceSlug ?? ''));
	const topic = $derived(`${plantSlug || '?'}/${deviceSlug || '?'}`);

	let migrateHistory = $state<'now' | 'later'>('now');

	let saving = $state(false);
	let errors = $state<Record<string, string>>({});
	let failure = $state<string | null>(null);

	// Decided here rather than in the template. A `?.` chain in an attribute reads
	// as chrome; what it actually encodes is "the one-time window is open", which is
	// the single most consequential fact on this screen.
	const slugEditable = $derived(status?.slugEditable ?? false);
	const submitLabel = $derived(saving ? m.migration_submitting() : m.migration_submit());
	const submitDisabled = $derived(saving || status === null);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (status === null) return;
		saving = true;
		errors = {};
		failure = null;
		const result = await migration.confirm({
			plantName,
			deviceName,
			...slugFields({
				editable: status.slugEditable,
				plantSlug,
				deviceSlug,
				current: { plantSlug: status.plantSlug, deviceSlug: status.deviceSlug }
			}),
			migrateHistory
		});
		saving = false;
		if (result.ok) {
			await goto(resolve('/'));
			return;
		}
		if ('errors' in result) errors = result.errors;
		else failure = result.message;
	}
</script>

<AuthShell title={m.migration_page_title()} subtitle={m.migration_page_subtitle()}>
	<Card.Root>
		<Card.Header>
			<Card.Description>{m.migration_why()}</Card.Description>
		</Card.Header>
		<Card.Content>
			<form class="flex flex-col gap-4" onsubmit={submit}>
				<LabelledField
					id="plant-name"
					label={m.migration_plant_name_label()}
					bind:bound={plantName}
					error={errors.plantName}
					required
				/>
				<LabelledField
					id="device-name"
					label={m.migration_device_name_label()}
					bind:bound={deviceName}
					error={errors.deviceName}
					required
				/>

				<IdentifierPanel
					{topic}
					{plantSlug}
					{deviceSlug}
					editable={slugEditable}
					{errors}
					onPlantSlug={(value) => (plantSlugOverride = value)}
					onDeviceSlug={(value) => (deviceSlugOverride = value)}
				/>

				<HistoryChoice bind:value={migrateHistory} />

				{#if failure}
					<p class="text-xs text-destructive">{m.migration_failed({ error: failure })}</p>
				{/if}

				<Button type="submit" class="h-9 w-full sm:h-8" disabled={submitDisabled}>
					{submitLabel}
				</Button>
			</form>
		</Card.Content>
	</Card.Root>
</AuthShell>
