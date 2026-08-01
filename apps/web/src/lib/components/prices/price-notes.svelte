<script lang="ts">
	import * as Alert from '$lib/components/ui/alert';
	import * as m from '$lib/paraglide/messages';

	// The caveats that must travel with a price series, kept out of the panel so
	// that file stays a layout.
	let {
		tomorrowPending,
		coarse,
		attribution
	}: {
		/** Tomorrow's auction hasn't cleared, so its negative slots are unknown. */
		tomorrowPending: boolean;
		/** Source is hourly, so a negative quarter-hour inside an hour is invisible. */
		coarse: boolean;
		/** Credit line required by the source's licence, when it has one. */
		attribution: string | null;
	} = $props();
</script>

{#if tomorrowPending}
	<Alert.Root>
		<Alert.Description>{m.prices_tomorrow_pending()}</Alert.Description>
	</Alert.Root>
{/if}

{#if coarse}
	<Alert.Root>
		<Alert.Description>{m.prices_hourly_source()}</Alert.Description>
	</Alert.Root>
{/if}

{#if attribution}
	<!-- CC BY 4.0 for the default source: the credit is a licence condition. -->
	<p class="text-xs text-muted-foreground">{attribution}</p>
{/if}
