<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Switch } from '$lib/components/ui/switch';
	import * as m from '$lib/paraglide/messages';
	import type { IntegrationView } from '../devices/device-types';

	// The two controls that act on the integration AS A WHOLE, in the card's
	// header where controls for the card's subject belong. Editing its settings
	// is a section of its own further down, because that is a form and not a
	// button.
	//
	// The switch writes immediately (`PATCH { enabled }`); Remove opens the
	// parent's confirm, because it retires devices and has to say so first.
	let {
		integration,
		busy,
		onToggle,
		onRemove
	}: {
		integration: IntegrationView;
		busy: boolean;
		onToggle: (enabled: boolean) => void;
		onRemove: () => void;
	} = $props();
</script>

<Switch
	id="integration-enabled"
	checked={integration.enabled}
	disabled={busy}
	aria-label={integration.label}
	onCheckedChange={(v) => onToggle(v === true)}
/>
<Button variant="ghost" size="sm" class="h-9 sm:h-8" disabled={busy} onclick={onRemove}>
	{m.devices_integration_action_remove()}
</Button>
