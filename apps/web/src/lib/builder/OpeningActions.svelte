<!-- The context toolbar for a wall opening (ADR 20): it is duplicated beside itself, and its night
  light chosen. -->
<script lang="ts">
  import Copy from "@lucide/svelte/icons/copy";
  import Lightbulb from "@lucide/svelte/icons/lightbulb";
  import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.js";
  import { m } from "../paraglide/messages.js";
  import { duplicateAt, lightAt } from "./context-actions.ts";
  import type { Opening } from "./pv.ts";
  import type { Session } from "./session.svelte.ts";
  import ToolButton from "./ToolButton.svelte";

  let {
    session,
    opening,
    onrefuse,
  }: { session: Session; opening: Opening; onrefuse: (reason?: string) => void } = $props();

  const LIGHTS = [
    ["auto", m.opening_light_auto],
    ["on", m.opening_light_on],
    ["off", m.opening_light_off],
  ] as const;
</script>

<ToolButton
  icon={Copy}
  label={m.builder_duplicate()}
  onclick={() => {
    onrefuse(duplicateAt(session) ? undefined : m.opening_refused_room());
  }}
/>
{#if opening.kind !== "garageDoor"}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <ToolButton {...props} icon={Lightbulb} label={m.opening_light()} />
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="center" class="w-44">
      <DropdownMenu.RadioGroup
        value={opening.light ?? "auto"}
        onValueChange={(value) => {
          const chosen = LIGHTS.find(([light]) => light === value)?.[0];

          if (chosen !== undefined) lightAt(session, chosen);
        }}
      >
        {#each LIGHTS as [light, label] (light)}
          <DropdownMenu.RadioItem class="min-h-11" value={light}>{label()}</DropdownMenu.RadioItem>
        {/each}
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/if}
