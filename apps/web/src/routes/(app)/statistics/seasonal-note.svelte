<script lang="ts">
	import type { SeasonalGap } from '@SunReye/contracts/statistics';
	import { resolve } from '$lib/resolve';
	import * as m from '$lib/paraglide/messages';
	import { useAppSession } from '$lib/session';

	// Whether the per-year figures are seasonally weighted, and if not, what is
	// left to configure — each item a link to the page that configures it. The
	// list is for everyone; the links only for the people who can act on them.
	let { weighting, gaps }: { weighting: 'solar' | 'calendar'; gaps: SeasonalGap[] } = $props();

	const session = useAppSession();
	const isAdmin = $derived($session.data?.user.role === 'admin');

	const GAPS: Record<SeasonalGap, { label: () => string; href: '/settings/weather' | '/settings/devices' }> = {
		weather: { label: m.amortisation_gap_weather, href: '/settings/weather' },
		location: { label: m.amortisation_gap_location, href: '/settings/weather' },
		arrays: { label: m.amortisation_gap_arrays, href: '/settings/devices' }
	};
	// Admins get a link; everyone else the same words as text.
	const items = $derived(
		gaps.map((g) => ({
			label: GAPS[g].label(),
			tag: isAdmin ? ('a' as const) : ('span' as const),
			href: isAdmin ? resolve(GAPS[g].href) : undefined,
			class: isAdmin ? 'underline underline-offset-2' : ''
		}))
	);
</script>

{#if weighting === 'solar'}
	<p class="text-xs text-muted-foreground">{m.amortisation_seasonal_note()}</p>
{:else if items.length > 0}
	<div class="flex flex-col gap-1 text-xs text-muted-foreground">
		<p>{m.amortisation_seasonal_off()}</p>
		<ul class="list-inside list-disc">
			{#each items as item (item.label)}
				<li>
					<svelte:element this={item.tag} class={item.class} href={item.href}>{item.label}</svelte:element>
				</li>
			{/each}
		</ul>
	</div>
{/if}
