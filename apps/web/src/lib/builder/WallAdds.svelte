<!-- "Hinzufügen" at a wall spot (ADR 20): a window or a door there, or a marker for the plant's
  first device; what does not fit is refused in words. -->
<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.js";
  import { m } from "../paraglide/messages.js";
  import { OPENING_KINDS } from "./names.ts";
  import type { Session } from "./session.svelte.ts";
  import ToolButton from "./ToolButton.svelte";
  import { addOnWall, type WallAdd } from "./wall-actions.ts";

  let { session, onrefuse }: { session: Session; onrefuse: (reason?: string) => void } = $props();

  const MARKERS = [
    ["inverter", m.equipment_inverter],
    ["battery", m.equipment_battery],
  ] as const;

  /** Markers name the first device (ADR 10); none, none offered. */
  const device = $derived(session.plan.devices[0]?.id);

  function add(choice: WallAdd): void {
    onrefuse(addOnWall(session, choice));
  }
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <ToolButton {...props} variant="default" icon={Plus} label={m.builder_add()} />
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="start" class="w-52">
    {#each OPENING_KINDS as [opening, name] (opening)}
      <DropdownMenu.Item
        class="min-h-11"
        onSelect={() => {
          add({ opening });
        }}>{name()}</DropdownMenu.Item
      >
    {/each}
    {#if device !== undefined}
      <DropdownMenu.Separator />
      {#each MARKERS as [marker, name] (marker)}
        <DropdownMenu.Item
          class="min-h-11"
          onSelect={() => {
            add({ marker, device });
          }}>{name()}</DropdownMenu.Item
        >
      {/each}
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
