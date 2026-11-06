<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Label } from '$lib/components/ui/label';
	import * as Table from '$lib/components/ui/table';
	import type { Guarded } from '$lib/archive-import/import-client';
	import * as m from '$lib/paraglide/messages';

	// The automation guard: the archive turned 3.x automation on or still holds a register. Open while
	// `guarded` is set. Only Continue (after the tick) or Cancel ends it: Escape, the backdrop and a close
	// button would each be a way out the user did not choose.
	let {
		guarded,
		busy,
		onContinue,
		onCancel
	}: {
		guarded: Guarded | null;
		busy: boolean;
		/** Called with the sha256 the guard answered with: what the core's confirmation names. */
		onContinue: (sha256: string) => void;
		onCancel: () => void;
	} = $props();

	let confirmed = $state(false);
	$effect(() => {
		if (guarded === null) confirmed = false;
	});
</script>

<Dialog.Root open={guarded !== null}>
	<Dialog.Content
		showCloseButton={false}
		escapeKeydownBehavior="ignore"
		interactOutsideBehavior="ignore"
		class="sm:max-w-lg"
	>
		<Dialog.Header>
			<Dialog.Title>{m.import_guard_title()}</Dialog.Title>
			<Dialog.Description>{m.import_guard_body()}</Dialog.Description>
		</Dialog.Header>
		{#if guarded}
			{#if guarded.held.length === 0}
				<p class="text-sm text-muted-foreground">{m.import_guard_none()}</p>
			{:else}
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>{m.import_guard_holder()}</Table.Head>
							<Table.Head>{m.import_guard_value()}</Table.Head>
							<Table.Head>{m.import_guard_captured()}</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each guarded.held as held (held.key)}
							<Table.Row>
								<Table.Cell class="break-all">{held.key}</Table.Cell>
								<Table.Cell>{held.value}</Table.Cell>
								<Table.Cell class="break-all">{held.capturedAt}</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			{/if}
			<div class="flex items-center gap-2">
				<!-- Reach is -inset-4, not TAP's 3.5: the 1px border sits outside the inset box. -->
				<Checkbox
					id="import-guard-confirm"
					class="after:-inset-4"
					bind:checked={confirmed}
					disabled={busy}
				/>
				<Label for="import-guard-confirm">{m.import_guard_confirm()}</Label>
			</div>
		{/if}
		<Dialog.Footer>
			<Button variant="outline" disabled={busy} onclick={onCancel}>{m.action_cancel()}</Button>
			<Button
				disabled={!confirmed || busy}
				onclick={() => guarded && onContinue(guarded.sha256)}
			>
				{m.action_continue()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
