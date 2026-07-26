<script lang="ts">
	/**
	 * Lists why an automation cannot run. Renders nothing when nothing blocks it,
	 * so callers can drop it in unconditionally.
	 */
	import * as Alert from '$lib/components/ui/alert';
	import { resolve } from '$lib/resolve';
	import * as m from '$lib/paraglide/messages';
	import type { Blocker } from '$lib/automations';

	let { blockers }: { blockers: Blocker[] } = $props();

	const CONFIG_LABEL: Record<Extract<Blocker, { kind: 'config' }>['what'], () => string> = {
		'export-limit': m.automations_blocker_export_limit,
		battery: m.automations_blocker_battery
	};
	// Roles the engine names explicitly; anything else falls back to the raw role.
	const ROLE_LABEL: Record<string, () => string> = {
		'setting.battery.max_charge_current': m.automations_blocker_role_charge,
		'pv.total.power': m.automations_blocker_role_pv,
		'battery.soc': m.automations_blocker_role_soc
	};

	function blockerLabel(b: Blocker): string {
		if (b.kind === 'config') return CONFIG_LABEL[b.what]();
		return ROLE_LABEL[b.role]?.() ?? m.automations_blocker_role_generic({ role: b.role });
	}
</script>

{#if blockers.length > 0}
	<Alert.Root variant="destructive">
		<Alert.Title>{m.automations_blockers_title()}</Alert.Title>
		<Alert.Description>
			<ul class="list-disc pl-4">
				{#each blockers as blocker (blockerLabel(blocker))}
					<li>
						{blockerLabel(blocker)}
						{#if blocker.kind === 'config'}
							<a class="underline underline-offset-2" href={resolve('/settings/weather')}>
								{m.automations_blocker_config_link()}
							</a>
						{/if}
					</li>
				{/each}
			</ul>
		</Alert.Description>
	</Alert.Root>
{/if}
