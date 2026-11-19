<!-- The context toolbar for the wiring mode's selection (ADR 20): how many modules are picked, and
  what becomes of them: wired into the open string or one of the menu, into a new string either way, unwired,
  or dropped. -->
<script lang="ts">
  import Cable from "@lucide/svelte/icons/cable";
  import Plus from "@lucide/svelte/icons/plus";
  import Unplug from "@lucide/svelte/icons/unplug";
  import X from "@lucide/svelte/icons/x";
  import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.js";
  import type { StringDraft } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { stringCss } from "./scene.ts";
  import ToolButton from "./ToolButton.svelte";
  import type { WiringMode } from "./wiring-mode.svelte.ts";

  let { wiring, strings }: { wiring: WiringMode; strings: readonly StringDraft[] } = $props();

  const picked = $derived(wiring.picked);
  const name = $derived(picked === undefined ? "" : (strings[picked]?.name ?? ""));
</script>

<span class="shrink-0 px-2 text-sm font-medium tabular-nums">
  {m.builder_selected({ count: wiring.selection.length })}
</span>
{#if picked !== undefined}
  <ToolButton
    variant="default"
    icon={Cable}
    label={name}
    class="min-w-0 shrink"
    aria-label={m.builder_wire_into({ name })}
    onclick={() => {
      wiring.into(picked);
    }}
  />
  <ToolButton
    icon={Plus}
    label=""
    class="w-11 px-0"
    aria-label={m.builder_module_new_string()}
    onclick={() => {
      wiring.intoNew();
    }}
  />
{:else}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <ToolButton {...props} variant="default" icon={Cable} label={m.builder_wire()} />
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="w-56">
      {#each strings as string, index (index)}
        <DropdownMenu.Item
          class="min-h-11"
          onSelect={() => {
            wiring.into(index);
          }}
        >
          <span class="size-2.5 shrink-0 rounded-sm" style:background={stringCss(index)}></span>
          <span class="truncate">{string.name}</span>
        </DropdownMenu.Item>
      {/each}
      <DropdownMenu.Item
        class="min-h-11"
        onSelect={() => {
          wiring.intoNew();
        }}>{m.builder_module_new_string()}</DropdownMenu.Item
      >
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/if}
<ToolButton
  icon={Unplug}
  label={m.builder_unwire()}
  onclick={() => {
    wiring.unwire();
  }}
/>
<ToolButton
  icon={X}
  label=""
  class="w-11 px-0"
  aria-label={m.builder_selection_clear()}
  onclick={() => {
    wiring.select([]);
  }}
/>
