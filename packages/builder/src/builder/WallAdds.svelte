<!-- "Hinzufügen" at a wall spot (ADR 20): a window or a door there, or a marker for one of the
  plant's devices, chosen where it has several; what does not fit is refused in words. -->
<script lang="ts" module>
  import { m } from "../paraglide/messages.js";

  const MARKERS = [
    ["inverter", m.equipment_inverter],
    ["battery", m.equipment_battery],
  ] as const;
</script>

<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import * as DropdownMenu from "@sunreye/ui/dropdown-menu";
  import { OPENING_KINDS } from "./names.ts";
  import type { Session } from "./session.svelte.ts";
  import ToolButton from "./ToolButton.svelte";
  import WallMarker from "./WallMarker.svelte";
  import { addOnWall, type WallAdd } from "./wall-actions.ts";

  let { session, onrefuse }: { session: Session; onrefuse: (reason?: string) => void } = $props();

  /** What a marker may name (ADR 10); none, none offered. */
  const devices = $derived(session.plan.devices);

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
        }}
      >
        {name()}
      </DropdownMenu.Item>
    {/each}
    {#if devices.length > 0}
      <DropdownMenu.Separator />
    {/if}
    {#each devices.length > 0 ? MARKERS : [] as [marker, name] (marker)}
      <WallMarker {marker} name={name()} {devices} onadd={add} />
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
