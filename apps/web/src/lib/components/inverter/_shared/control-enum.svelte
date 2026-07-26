<script lang="ts">
	// Writable enum setting. A plain 0/1 enum is an on-off switch; anything wider is
	// a select over the enum's own labels.
	import { Switch } from '$lib/components/ui/switch';
	import * as Select from '$lib/components/ui/select';
	import * as m from '$lib/paraglide/messages';

	let {
		enumLabels,
		enumKeys,
		value,
		busy,
		onWrite
	}: {
		/** Enum value → label, from the profile manifest. */
		enumLabels: Record<number, string>;
		/** Ascending enum values. */
		enumKeys: number[];
		value: number;
		busy: boolean;
		onWrite: (v: number) => void;
	} = $props();

	/** A 0/1 enum is a plain on-off toggle. */
	const isToggle = $derived(enumKeys.length === 2 && enumKeys[0] === 0 && enumKeys[1] === 1);

	const selectedLabel = $derived(enumLabels[value] ?? m.option_select_placeholder());

	const setChecked = (checked: boolean) => onWrite(checked ? 1 : 0);
	const setSelected = (v: string) => onWrite(Number(v));
</script>

{#if isToggle}
	<Switch checked={value === 1} onCheckedChange={setChecked} disabled={busy} />
{:else}
	<Select.Root type="single" value={String(value)} onValueChange={setSelected}>
		<Select.Trigger class="w-full">{selectedLabel}</Select.Trigger>
		<Select.Content>
			{#each enumKeys as k (k)}
				<Select.Item value={String(k)}>{enumLabels[k]}</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
{/if}
