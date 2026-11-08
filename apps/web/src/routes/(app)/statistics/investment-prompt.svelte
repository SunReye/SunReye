<script lang="ts">
	import Coins from 'phosphor-svelte/lib/Coins';
	import * as m from '$lib/paraglide/messages';
	import EmptyState from '$lib/components/layout/empty-state.svelte';
</script>

<!-- The amortisation section before a price is entered: say what is missing. The core serves no
     investment setting, so there is no panel to send anybody to. -->
<EmptyState message={m.amortisation_empty()} icon={Coins} />
