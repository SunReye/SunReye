<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	/**
	 * "MIGRATE HISTORY NOW / LATER" — and `later` is a real, recorded answer.
	 *
	 * Not a checkbox and not a hidden default. Deferring writes the `deferred` stage
	 * and keeps the app-wide banner, because a deferral that leaves the app looking
	 * complete never gets run (`@SunReye/db/upgrade-state`). Each option carries what
	 * it costs, since "a few minutes" and "history stays unavailable" are the only
	 * facts the choice turns on.
	 */
	let { value = $bindable() }: { value: 'now' | 'later' } = $props();

	const options = [
		{ key: 'now', label: m.migration_history_now, hint: m.migration_history_now_hint },
		{ key: 'later', label: m.migration_history_later, hint: m.migration_history_later_hint }
	] as const;
</script>

<fieldset class="flex flex-col gap-2">
	<legend class="mb-2 text-sm font-medium">{m.migration_history_question()}</legend>
	{#each options as option (option.key)}
		<label class="flex items-start gap-3 py-1">
			<input
				type="radio"
				name="migrate-history"
				class="mt-1 size-4"
				value={option.key}
				checked={value === option.key}
				onchange={() => (value = option.key)}
			/>
			<span class="flex min-w-0 flex-col">
				<span class="text-sm">{option.label()}</span>
				<span class="text-xs text-muted-foreground">{option.hint()}</span>
			</span>
		</label>
	{/each}
</fieldset>
