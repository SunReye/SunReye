<script lang="ts">
	import { page } from '$app/state';
	import { fly } from 'svelte/transition';
	import { MediaQuery } from 'svelte/reactivity';
	import { api } from '$lib/api';
	import { routePath } from '$lib/resolve';
	import { useAppSession } from '$lib/session';
	import SettingsNav from './settings-nav.svelte';
	import { setSettingsStatus, type SettingsStatus } from './status-context';
	import { setPageHeader } from '$lib/page-header.svelte';
	import * as m from '$lib/paraglide/messages';

	const { children } = $props();

	const session = useAppSession();
	const isAdmin = $derived($session.data?.user.role === 'admin');

	// The hash router pins `page.url.pathname` to the served document, so the
	// active route has to be read from the hash (see `routePath`).
	const current = $derived(routePath(page.url));

	// Live connection health, polled once for the whole settings area and shared
	// with the Inverter/MQTT panels through context.
	let status = $state<SettingsStatus>(null);
	setSettingsStatus({
		get current() {
			return status;
		}
	});

	$effect(() => {
		let stop = false;
		const tick = async () => {
			const { data } = await api.api.status.get();
			if (!stop && data) status = data as SettingsStatus;
		};
		tick();
		const id = setInterval(tick, 3000);
		return () => {
			stop = true;
			clearInterval(id);
		};
	});

	// Only the changing panel moves; the nav rail stays put. Honour reduced motion.
	const reduceMotion = new MediaQuery('prefers-reduced-motion: reduce');
	const panelIn = $derived(reduceMotion.current ? { duration: 0 } : { y: 6, duration: 180 });

	$effect(() => setPageHeader(m.nav_settings(), m.settings_subtitle()));
</script>

<div class="mx-auto w-full max-w-5xl p-4 sm:p-6">
	<div class="flex flex-col gap-6 md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10">
		<SettingsNav {isAdmin} {current} />

		<div class="min-w-0">
			{#key current}
				<div class="flex flex-col gap-6" in:fly={panelIn}>
					{@render children()}
				</div>
			{/key}
		</div>
	</div>
</div>
