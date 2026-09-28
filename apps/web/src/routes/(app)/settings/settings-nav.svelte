<script lang="ts">
	import type { Component } from 'svelte';
	import SettingsNavLink from './settings-nav-link.svelte';
	import { SETTINGS_ROUTES, message, type SettingsGroup, type SettingsRoute } from './nav-routes';
	import * as m from '$lib/paraglide/messages';
	import LightningIcon from 'phosphor-svelte/lib/Lightning';
	import PlugsConnectedIcon from 'phosphor-svelte/lib/PlugsConnected';
	import WaveformIcon from 'phosphor-svelte/lib/Waveform';
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

	let {
		isAdmin,
		current,
		stripHeight = $bindable(0)
	}: {
		isAdmin: boolean;
		current: string;
		/**
		 * The phone tab strip's laid-out height, handed back to the settings
		 * layout so the panel below can push its own sticky chrome clear of it.
		 * Measured rather than declared: the strip is `display: none` from `md:`,
		 * where the browser reports 0 and the panel's save bar correctly sticks
		 * straight under the header. A hard-coded `2.5rem` would have been wrong
		 * on the desktop and wrong again the first time a tab grew a second line.
		 */
		stripHeight?: number;
	} = $props();

	// Routes, labels and grouping come from `nav-routes.ts` — the same table the
	// shell header reads, so a panel cannot appear in the rail with no title.
	// Only the icons live here: they are `.svelte` imports, and the table has to
	// stay loadable outside a bundler.
	const ICONS: Record<string, Component> = {
		devices: PlugsConnectedIcon,
		plant: LightningIcon,
		sensors: WaveformIcon,
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
	const visible = $derived(
		SETTINGS_ROUTES.filter((r) => !r.hidden && (isAdmin || r.group !== 'admin'))
	);

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
	<!-- `--sticky-top` is the shell's contract (see `(app)/+layout.svelte`): the
	     first y a sticky box may claim, because the DOCUMENT is what scrolls and
	     the header owns the band above it. `top-6` alone parked the rail's first
	     group under the header. -->
	<div class="sticky top-[calc(var(--sticky-top,0px)+1.5rem)] flex flex-col gap-6">
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
     only earn their space on the desktop rail).
     Scrollbars are never painted app-wide (app.css), so a strip that runs past
     the right edge simply looked CLIPPED — fifteen panels, and no cue that the
     last five exist (#214). The fade says the row continues, and the snap makes
     a swipe land on a whole tab instead of halfway through one. Proximity snap,
     not mandatory: mandatory fights a scroll that means to reach the end.

     Sticky, directly under the header (`--sticky-top`, see
     `(app)/+layout.svelte`): a settings panel is a long form, and a strip that
     scrolls away turns "switch panel" into "scroll all the way back up first".
     Opaque, because the form scrolls underneath it. `z-30` is the shell's tier
     for a section's own sticky nav — above the panel's save bar, below the
     header. The wrapper is the sticky box AND the fade's positioning context
     (sticky is positioned), so the fade cannot travel with the scrolled row. -->
<div
	bind:clientHeight={stripHeight}
	class="sticky top-[var(--sticky-top,0px)] z-30 -mx-4 bg-background md:hidden"
>
	<nav class="snap-x overflow-x-auto px-4" aria-label={m.nav_settings()}>
		<div class="flex w-max gap-1 pb-1">
			{#each visible as route (route.id)}
				{@render navLink(route, 'shrink-0 snap-start gap-2 border border-transparent px-3 py-1.5')}
			{/each}
		</div>
	</nav>
	<div
		aria-hidden="true"
		class="pointer-events-none absolute inset-y-0 right-0 w-6 bg-linear-to-l from-background to-transparent"
	></div>
</div>
