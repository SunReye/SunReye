<script lang="ts">
	import type { Component } from 'svelte';
	import SettingsNavLink from './settings-nav-link.svelte';
	import { SETTINGS_ROUTES, message, type SettingsGroup, type SettingsRoute } from './nav-routes';
	import * as m from '$lib/paraglide/messages';
	import LightningIcon from 'phosphor-svelte/lib/Lightning';
	import PlugsConnectedIcon from 'phosphor-svelte/lib/PlugsConnected';
	import WaveformIcon from 'phosphor-svelte/lib/Waveform';
	import BroadcastIcon from 'phosphor-svelte/lib/Broadcast';
	import MonitorIcon from 'phosphor-svelte/lib/Monitor';
	import ReceiptIcon from 'phosphor-svelte/lib/Receipt';
	import ChartLineIcon from 'phosphor-svelte/lib/ChartLine';
	import CloudSunIcon from 'phosphor-svelte/lib/CloudSun';
	import ShieldCheckIcon from 'phosphor-svelte/lib/ShieldCheck';
	import StackIcon from 'phosphor-svelte/lib/Stack';
	import UsersIcon from 'phosphor-svelte/lib/Users';
	import KeyIcon from 'phosphor-svelte/lib/Key';
	import TerminalWindowIcon from 'phosphor-svelte/lib/TerminalWindow';
	import RobotIcon from 'phosphor-svelte/lib/Robot';
	import WarningIcon from 'phosphor-svelte/lib/Warning';

	let { isAdmin, current }: { isAdmin: boolean; current: string } = $props();

	// Routes, labels and grouping come from `nav-routes.ts` — the same table the
	// shell header reads, so a panel cannot appear in the rail with no title.
	// Only the icons live here: they are `.svelte` imports, and the table has to
	// stay loadable outside a bundler.
	const ICONS: Record<string, Component> = {
		inverter: LightningIcon,
		devices: PlugsConnectedIcon,
		sensors: WaveformIcon,
		mqtt: BroadcastIcon,
		display: MonitorIcon,
		tariff: ReceiptIcon,
		prices: ChartLineIcon,
		weather: CloudSunIcon,
		access: ShieldCheckIcon,
		automations: RobotIcon,
		profiles: StackIcon,
		users: UsersIcon,
		'api-keys': KeyIcon,
		logs: TerminalWindowIcon,
		danger: WarningIcon
	};

	const GROUP_LABELS: Record<SettingsGroup, () => string> = {
		connection: m.settings_group_connection,
		preferences: m.settings_group_preferences,
		admin: m.settings_group_admin
	};

	// Profiles/Access/Users/API keys/Danger zone are admin-only management
	// surfaces; the group appears once we know the viewer is an admin.
	const visible = $derived(SETTINGS_ROUTES.filter((r) => isAdmin || r.group !== 'admin'));

	const groups = $derived(
		(['connection', 'preferences', 'admin'] as const)
			.map((group) => ({
				group,
				label: GROUP_LABELS[group](),
				items: visible.filter((r) => r.group === group)
			}))
			.filter((g) => g.items.length > 0)
	);
</script>

{#snippet navLink(route: SettingsRoute, extra: string)}
	<SettingsNavLink
		href={route.href}
		label={message(route.titleKey)}
		icon={ICONS[route.id]}
		active={current === route.href}
		{extra}
	/>
{/snippet}

<!-- Desktop: grouped vertical menu. -->
<nav class="hidden md:block" aria-label={m.nav_settings()}>
	<div class="sticky top-6 flex flex-col gap-6">
		{#each groups as group (group.group)}
			<div class="flex flex-col gap-1">
				<p class="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
					{group.label}
				</p>
				{#each group.items as route (route.id)}
					{@render navLink(route, 'gap-2.5 px-2 py-1.5')}
				{/each}
			</div>
		{/each}
	</div>
</nav>

<!-- Mobile: single-line horizontal scroll of every panel (the group headers
     only earn their space on the desktop rail). -->
<nav class="-mx-4 overflow-x-auto px-4 md:hidden" aria-label={m.nav_settings()}>
	<div class="flex w-max gap-1 pb-1">
		{#each visible as route (route.id)}
			{@render navLink(route, 'shrink-0 gap-2 border border-transparent px-3 py-1.5')}
		{/each}
	</div>
</nav>
