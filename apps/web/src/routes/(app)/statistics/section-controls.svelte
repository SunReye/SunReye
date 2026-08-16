<script lang="ts">
	import type { Snippet } from 'svelte';
	import Eye from 'phosphor-svelte/lib/Eye';
	import EyeSlash from 'phosphor-svelte/lib/EyeSlash';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as m from '$lib/paraglide/messages';
	import { getCustomizeSession } from '$lib/statistics/customize.svelte';
	import { TAP } from '$lib/layout/tokens';

	// Right-hand side of a section header: the section's own ephemeral controls
	// normally, the customize affordances (hide the section, have it start
	// collapsed) while an admin is editing the layout.
	let { id, title, controls }: { id: string; title: string; controls?: Snippet } = $props();

	const customize = getCustomizeSession();
	const hidden = $derived(customize.sectionHidden(id));
	const hideLabel = $derived(
		hidden
			? m.statistics_customize_show_section({ section: title })
			: m.statistics_customize_hide_section({ section: title })
	);
</script>

{#if customize.active}
	<label class="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
		<Checkbox
			checked={customize.sectionCollapsed(id)}
			onCheckedChange={() => customize.toggleCollapsed(id)}
		/>
		{m.statistics_customize_collapsed()}
	</label>
	<button
		type="button"
		class="{TAP} text-muted-foreground transition-colors hover:text-foreground"
		aria-label={hideLabel}
		onclick={() => customize.toggleSection(id)}
	>
		{#if hidden}
			<EyeSlash class="size-4" />
		{:else}
			<Eye class="size-4" />
		{/if}
	</button>
{:else if controls}
	{@render controls()}
{/if}
