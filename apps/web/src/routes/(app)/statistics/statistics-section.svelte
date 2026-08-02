<script lang="ts">
	import type { Snippet } from 'svelte';
	import { slide } from 'svelte/transition';
	import { MediaQuery } from 'svelte/reactivity';
	import CaretDown from 'phosphor-svelte/lib/CaretDown';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import * as m from '$lib/paraglide/messages';

	// Shell every statistics section renders in: bordered card, uppercase
	// title, range caption, and a collapse toggle so a long page folds down to
	// the sections the viewer cares about.
	let {
		title,
		caption,
		children
	}: {
		title: string;
		/** Range context under the title, e.g. "This month, by day". */
		caption?: string;
		children: Snippet;
	} = $props();

	let open = $state(true);

	// Mirror settings/+layout.svelte: content may move, but not for viewers who
	// asked for reduced motion.
	const reduceMotion = new MediaQuery('prefers-reduced-motion: reduce');
	const slideParams = $derived(reduceMotion.current ? { duration: 0 } : { duration: 200 });
</script>

<Collapsible.Root bind:open>
	<section class="flex flex-col gap-3 border border-border p-4">
		<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
			<div class="flex min-w-0 flex-col">
				<h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
				{#if caption}
					<p class="text-xs text-muted-foreground/70">{caption}</p>
				{/if}
			</div>
			<Collapsible.Trigger
				class="group text-muted-foreground transition-colors hover:text-foreground"
				aria-label={m.statistics_section_toggle_aria({ section: title })}
			>
				<CaretDown class="size-4 transition-transform group-data-[state=closed]:-rotate-90" />
			</Collapsible.Trigger>
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
