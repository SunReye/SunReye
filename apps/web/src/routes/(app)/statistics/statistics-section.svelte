<script lang="ts">
	import type { Snippet } from 'svelte';
	import { slide } from 'svelte/transition';
	import { MediaQuery } from 'svelte/reactivity';
	import CaretDown from 'phosphor-svelte/lib/CaretDown';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import * as m from '$lib/paraglide/messages';
	import { getCustomizeSession } from '$lib/statistics/customize.svelte';
	import SectionControls from './section-controls.svelte';

	// Shell every statistics section renders in: bordered card, uppercase
	// title, range caption, and a collapse toggle so a long page folds down to
	// the sections the viewer cares about. In customize mode the same shell
	// gets a dashed outline and the per-section visibility affordances.
	let {
		id,
		title,
		caption,
		controls,
		children
	}: {
		/** Section id from the registry — the key the preferences hide it by. */
		id: string;
		title: string;
		/** Range context under the title, e.g. "This month, by day". */
		caption?: string;
		/** Ephemeral per-view controls, shown in the header for every viewer. */
		controls?: Snippet;
		children: Snippet;
	} = $props();

	const customize = getCustomizeSession();

	// null until the viewer touches the toggle: until then the preference
	// supplies the initial state, which may only arrive once the prefs fetch
	// lands. Customize mode forces the content open — the per-tile checkboxes
	// live inside it.
	let viewerOpen = $state<boolean | null>(null);
	const open = $derived(customize.active || (viewerOpen ?? !customize.sectionCollapsed(id)));

	// Dashed outline while customizing; hidden sections preview at 40% (outside
	// customize mode they are never mounted in the first place).
	const shellClass = $derived(
		[
			'flex flex-col gap-3 border border-border p-4',
			customize.active ? 'border-dashed border-primary/60' : '',
			customize.sectionHidden(id) ? 'opacity-40' : ''
		].join(' ')
	);

	// Mirror settings/+layout.svelte: content may move, but not for viewers who
	// asked for reduced motion.
	const reduceMotion = new MediaQuery('prefers-reduced-motion: reduce');
	const slideParams = $derived(reduceMotion.current ? { duration: 0 } : { duration: 200 });
</script>

<Collapsible.Root {open} onOpenChange={(v) => (viewerOpen = v)}>
	<section class={shellClass}>
		<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
			<div class="flex min-w-0 flex-col">
				<h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
				{#if caption}
					<p class="text-xs text-muted-foreground/70">{caption}</p>
				{/if}
			</div>
			<div class="flex items-center gap-3">
				<SectionControls {id} {title} {controls} />
				<Collapsible.Trigger
					class="group text-muted-foreground transition-colors hover:text-foreground"
					aria-label={m.statistics_section_toggle_aria({ section: title })}
				>
					<CaretDown class="size-4 transition-transform group-data-[state=closed]:-rotate-90" />
				</Collapsible.Trigger>
			</div>
		</div>
		<!-- forceMount + child so the content can slide in and out; closed
		     sections unmount entirely (no hidden fetch-driving components). -->
		<Collapsible.Content forceMount>
			{#snippet child({ props, open: contentOpen })}
				{#if contentOpen}
					<div {...props} transition:slide={slideParams} class="flex flex-col gap-6">
						{@render children()}
					</div>
				{/if}
			{/snippet}
		</Collapsible.Content>
	</section>
</Collapsible.Root>
