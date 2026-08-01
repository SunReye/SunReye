<script lang="ts">
	import type { Component } from 'svelte';
	import type { Pathname } from '$app/types';
	import SettingsNavLink from './settings-nav-link.svelte';
	import * as m from '$lib/paraglide/messages';
	import LightningIcon from 'phosphor-svelte/lib/Lightning';
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

	type NavItem = { href: Pathname; label: string; icon: Component };
	type NavGroup = { label: string; items: NavItem[] };

	// Profiles/Access/Users/API keys/Danger zone are admin-only management
	// surfaces; the group is appended once we know the viewer is an admin.
	const groups = $derived<NavGroup[]>([
		{
			label: m.settings_group_connection(),
			items: [
				{ href: '/settings/inverter', label: m.label_inverter(), icon: LightningIcon },
				{ href: '/settings/sensors', label: m.settings_tab_sensors(), icon: WaveformIcon },
				{ href: '/settings/mqtt', label: m.settings_tab_mqtt(), icon: BroadcastIcon }
			]
		},
		{
			label: m.settings_group_preferences(),
			items: [
				{ href: '/settings/display', label: m.settings_tab_display(), icon: MonitorIcon },
				{ href: '/settings/tariff', label: m.settings_tab_tariff(), icon: ReceiptIcon },
				{ href: '/settings/prices', label: m.settings_tab_prices(), icon: ChartLineIcon },
				{ href: '/settings/weather', label: m.settings_tab_weather(), icon: CloudSunIcon }
			]
		},
		...(isAdmin
			? [
					{
						label: m.settings_group_admin(),
						items: [
							{ href: '/settings/access', label: m.settings_tab_access(), icon: ShieldCheckIcon },
							{
								href: '/settings/automations',
								label: m.settings_tab_automations(),
								icon: RobotIcon
							},
							{ href: '/settings/profiles', label: m.settings_tab_profiles(), icon: StackIcon },
							{ href: '/settings/users', label: m.settings_tab_users(), icon: UsersIcon },
							{ href: '/settings/api-keys', label: m.settings_tab_apikeys(), icon: KeyIcon },
							{ href: '/settings/logs', label: m.settings_tab_logs(), icon: TerminalWindowIcon },
							{ href: '/settings/danger', label: m.settings_tab_danger(), icon: WarningIcon }
						]
					} satisfies NavGroup
				]
			: [])
	]);

	// Flattened list drives the mobile scroll row (groups collapse to one line
	// there — the section headers only earn their space on the desktop rail).
	const flatItems = $derived(groups.flatMap((g) => g.items));
</script>

{#snippet navLink(item: NavItem, extra: string)}
	<SettingsNavLink
		href={item.href}
		label={item.label}
		icon={item.icon}
		active={current === item.href}
		{extra}
	/>
{/snippet}

<!-- Desktop: grouped vertical menu. -->
<nav class="hidden md:block" aria-label={m.nav_settings()}>
	<div class="sticky top-6 flex flex-col gap-6">
		{#each groups as group (group.label)}
			<div class="flex flex-col gap-1">
				<p class="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
					{group.label}
				</p>
				{#each group.items as item (item.href)}
					{@render navLink(item, 'gap-2.5 px-2 py-1.5')}
				{/each}
			</div>
		{/each}
	</div>
</nav>

<!-- Mobile: single-line horizontal scroll of every panel. -->
<nav class="-mx-4 overflow-x-auto px-4 md:hidden" aria-label={m.nav_settings()}>
	<div class="flex w-max gap-1 pb-1">
		{#each flatItems as item (item.href)}
			{@render navLink(item, 'shrink-0 gap-2 border border-transparent px-3 py-1.5')}
		{/each}
	</div>
</nav>
