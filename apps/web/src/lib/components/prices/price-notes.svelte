<script lang="ts">
	import * as Alert from '$lib/components/ui/alert';
	import * as m from '$lib/paraglide/messages';

	// The caveats that must travel with a price series, kept out of the panel so
	// that file stays a layout.
	let {
		coarse,
		attribution
	}: {
		/** Source is hourly, so a negative quarter-hour inside an hour is invisible. */
		coarse: boolean;
		/** Credit line required by the source's licence, when it has one. */
		attribution: string | null;
	} = $props();

	// The "tomorrow isn't published yet" note deliberately lives where tomorrow's
	// curve would be, not down here with the caveats — it explains a missing
	// chart, so it has to sit in that chart's place.
</script>

{#if coarse}
	<Alert.Root>
		<Alert.Description>{m.prices_hourly_source()}</Alert.Description>
	</Alert.Root>
{/if}

{#if attribution}
	<!-- CC BY 4.0 for the default source: the credit is a licence condition. -->
	<p class="text-xs text-muted-foreground">{attribution}</p>
{/if}
