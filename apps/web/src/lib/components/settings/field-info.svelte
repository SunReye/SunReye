<script lang="ts">
	import Info from 'phosphor-svelte/lib/Info';
	import * as Popover from '$lib/components/ui/popover';
	import { TAP } from '$lib/layout/tokens';
	import * as m from '$lib/paraglide/messages';

	// The "what is this" affordance for a settings field, matching the statistics
	// tiles: an ⓘ beside the label, explanation on tap.
	//
	// A popover rather than the paragraph of prose that used to sit under each
	// input. A settings form is a list of decisions, and a sentence under every
	// one of them buries the fields themselves — the reader scrolls past
	// explanation looking for the box. The explanation is still one tap away, and
	// still the same text; it just stops competing with the thing it describes.
	//
	// Renders the trigger ONLY, so each call site keeps whatever label or group
	// heading it already had rather than having its markup replaced.
	let { label, info }: { label: string; info: string } = $props();
</script>

<Popover.Root>
	<!-- TAP: an icon this size is a 14px target without it, well under the 44px
	     floor the mobile rules set for anything tappable. -->
	<Popover.Trigger
		class="{TAP} shrink-0 text-muted-foreground/70 transition-colors hover:text-foreground"
		aria-label={m.settings_field_info_aria({ label })}
	>
		<Info class="size-3.5" weight="bold" />
	</Popover.Trigger>
	<Popover.Content class="max-w-xs text-xs leading-relaxed">{info}</Popover.Content>
</Popover.Root>
