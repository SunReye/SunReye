<script lang="ts">
	// The sidebar's brand row AND the source picker: the plant, or one of its
	// devices, chosen once for the whole app (#202).
	//
	// It used to be a segmented switcher in the page header. A plant of two
	// devices is exactly three options — one under `needsCompactSwitcher`'s
	// `> 3` — so a phone got the `ToggleGroup`, whose items are `shrink-0
	// whitespace-nowrap` inside a header that does not clip, and the page
	// scrolled sideways at 400px (#215). The source is global client state that
	// the dashboard, history and statistics all read, so navigation chrome is
	// where it belongs; the sidebar is a fixed-width sheet, which removes the
	// class of bug rather than tuning a threshold.
	//
	// A single-source plant gets the SAME row, non-interactive and without the
	// chevron, so the sidebar header looks identical on every instance.
	import CaretUpDownIcon from 'phosphor-svelte/lib/CaretUpDown';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import Logo from '$lib/components/logo.svelte';
	import { source } from '$lib/source.svelte';
	import { sourceMenu } from '$lib/source';
	import * as m from '$lib/paraglide/messages';

	// The list, the mark and the second line all come from one place
	// (`$lib/source.ts`, proven in `source.test.ts`).
	const menu = $derived(sourceMenu(source.sources, m.source_plant(), source.current));
</script>

{#snippet brand()}
	<Logo class="size-8 shrink-0 text-primary" />
	<div class="flex min-w-0 flex-1 flex-col text-left group-data-[collapsible=icon]:hidden">
		<span class="truncate text-sm font-semibold leading-tight">SunReye</span>
		<span class="truncate text-xs leading-tight text-muted-foreground">{menu.currentLabel}</span>
	</div>
{/snippet}

<Sidebar.Menu>
	<Sidebar.MenuItem>
		{#if source.offersChoice}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Sidebar.MenuButton size="lg" data-source-switcher {...props}>
							{@render brand()}
							<CaretUpDownIcon
								class="ml-auto size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden"
							/>
						</Sidebar.MenuButton>
					{/snippet}
				</DropdownMenu.Trigger>
				<!-- Capped against the viewport, not the sidebar: a long device name
				     would otherwise push the menu past a phone's edge, which is the
				     bug this whole move exists to end. -->
				<DropdownMenu.Content
					align="start"
					class="w-(--bits-dropdown-menu-anchor-width) min-w-56 max-w-[calc(100vw-2rem)]"
				>
					<!-- `Label`, not `GroupHeading`: bits-ui's `GroupHeading` reads a
					     group context, and outside a `DropdownMenu.Group` it takes the
					     whole content down — silently, no console error, `aria-expanded`
					     still true and nothing on screen. `Label` is a plain div. -->
					<DropdownMenu.Label>{m.source_switcher_label()}</DropdownMenu.Label>
					<!-- The mark is `menu.activeId`, not `source.current`: a device
					     retired while this page is open leaves `current` naming a source
					     the list no longer has, and the plant is what that resolves to. -->
					<DropdownMenu.RadioGroup value={menu.activeId} onValueChange={(id) => source.select(id)}>
						{#each menu.options as option (option.id)}
							<DropdownMenu.RadioItem value={option.id}>
								<span class="truncate">{option.label}</span>
							</DropdownMenu.RadioItem>
						{/each}
					</DropdownMenu.RadioGroup>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{:else}
			<!-- Nothing to switch: one device reads the same under either name. A
			     div rather than a disabled button — there is no action to refuse,
			     and a button that opens nothing invites the tap twice. -->
			<Sidebar.MenuButton
				size="lg"
				data-source-switcher
				class="cursor-default hover:bg-transparent hover:text-sidebar-foreground active:bg-transparent active:text-sidebar-foreground"
			>
				{#snippet child({ props })}
					<div {...props}>{@render brand()}</div>
				{/snippet}
			</Sidebar.MenuButton>
		{/if}
	</Sidebar.MenuItem>
</Sidebar.Menu>
