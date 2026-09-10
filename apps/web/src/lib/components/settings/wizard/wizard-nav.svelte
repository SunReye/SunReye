<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as m from '$lib/paraglide/messages';

	// Cancel · Back · Next, where Next becomes Add on the last step. The label
	// and the handler both follow `last`, so the operator never sees a "Next"
	// that submits.
	let {
		first,
		last,
		blocked,
		busy,
		onCancel,
		onBack,
		onNext
	}: {
		first: boolean;
		last: boolean;
		blocked: boolean;
		busy: boolean;
		onCancel: () => void;
		onBack: () => void;
		onNext: () => void;
	} = $props();
</script>

<div class="flex flex-wrap items-center justify-end gap-2">
	<Button variant="ghost" class="h-9 sm:h-8" onclick={onCancel}>{m.action_cancel()}</Button>
	<Button variant="outline" class="h-9 sm:h-8" disabled={first} onclick={onBack}>
		{m.wizard_back()}
	</Button>
	<Button class="h-9 sm:h-8" disabled={blocked || busy} onclick={onNext}>
		{last ? m.wizard_finish() : m.wizard_next()}
	</Button>
</div>
