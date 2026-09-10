<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as m from '$lib/paraglide/messages';
	import type { AttachOption } from './add-wizard';

	// One thing that could be attached. A SINGLE-instance entry that this
	// connection already carries is shown disabled rather than dropped: an option
	// that silently vanishes reads as a missing feature, not as a rule.
	let {
		option,
		chosen,
		onpick
	}: {
		option: AttachOption;
		chosen: boolean;
		onpick: () => void;
	} = $props();
</script>

<Button
	variant={chosen ? 'default' : 'outline'}
	class="h-auto justify-start py-3 text-left"
	disabled={option.taken}
	onclick={onpick}
>
	<span class="flex flex-col gap-0.5">
		<span class="text-sm font-medium">{option.entry.label}</span>
		{#if option.taken}
			<span class="text-xs opacity-80">{m.wizard_attach_taken()}</span>
		{/if}
	</span>
</Button>
