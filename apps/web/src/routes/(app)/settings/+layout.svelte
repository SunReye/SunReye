<script lang="ts">
	import { page } from '$app/state';
	import { fly } from 'svelte/transition';
	import { MediaQuery } from 'svelte/reactivity';
	import { api } from '$lib/api';
	import { routePath } from '$lib/resolve';
	import { useAppSession } from '$lib/session';
	import SettingsNav from './settings-nav.svelte';
	import { settingsHeaderFor } from './nav-routes';
	import { setSettingsStatus, type SettingsStatus } from './status-context';
	import PageShell from '$lib/components/layout/page-shell.svelte';
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

	// One header per panel, read from the route table the nav rail renders. The
	// panels themselves never call setPageHeader — fourteen call sites is fourteen
	// chances to ship the fifteenth panel titled "Settings", which is what the
	// area-wide header did for all of them. The fallback covers `/settings`
	// itself, which only redirects on to the first panel.
	const header = $derived(settingsHeaderFor(current));
	$effect(() =>
		setPageHeader(
			header ? header.title() : m.nav_settings(),
			header ? header.subtitle() : m.settings_subtitle()
		)
	);
</script>

<PageShell width="wide">
	<!-- `md:` is the ONE grandfathered breakpoint in the codebase (tokens.ts bans
	     it, tokens.test.ts fails on a new one): the rail is a fixed 13rem column,
	     and 13rem plus a panel wide enough to hold a form only fits from 768px.
	     `sm:` (640px) puts the panel at 27rem — narrower than the forms in it —
	     and `lg:` (1024px) leaves tablets stacked with half the width unused.
	     There is no token pair that lands the rail where this does. -->
	<div class="flex flex-col gap-6 md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10">
		<SettingsNav {isAdmin} {current} />

		<!-- Wide shell, narrow panel: the shell measure has to cover rail + panel,
		     but the panel itself is forms and prose and is capped at the reading
		     measure so it does not run to 60rem of input fields. -->
		<div class="min-w-0 max-w-3xl">
			{#key current}
				<div class="flex flex-col gap-6" in:fly={panelIn}>
					{@render children()}
				</div>
			{/key}
		</div>
	</div>
</PageShell>
