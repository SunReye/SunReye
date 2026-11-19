<!-- The wiring mode's selection (ADR 20): how many modules are picked, and what becomes of them:
  wired into the open string or one of the menu, into a new string, unwired, or dropped. -->
<script lang="ts">
  import Cable from "@lucide/svelte/icons/cable";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import X from "@lucide/svelte/icons/x";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.js";
  import type { StringDraft } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { stringCss } from "./scene.ts";
  import type { WiringMode } from "./wiring-mode.svelte.ts";

  let { wiring, strings }: { wiring: WiringMode; strings: readonly StringDraft[] } = $props();

  const picked = $derived(wiring.picked);
  const name = $derived(picked === undefined ? "" : (strings[picked]?.name ?? ""));
</script>

<div
  role="toolbar"
  aria-label={m.builder_selection()}
  class="flex min-h-12 items-center gap-1.5 border-b border-border/60 px-1.5"
>
  <Button
    variant="ghost"
    size="icon-lg"
    class="size-11 shrink-0"
    aria-label={m.builder_selection_clear()}
    onclick={() => {
      wiring.select([]);
    }}><X /></Button
  >
  <span class="mr-auto shrink-0 text-sm font-medium tabular-nums">
    {m.builder_selected({ count: wiring.selection.length })}
  </span>
  <Button
    variant="outline"
    class="min-h-11 shrink-0"
    onclick={() => {
      wiring.unwire();
    }}>{m.builder_unwire()}</Button
  >
  {#if picked !== undefined}
    <Button
      class="min-h-11 min-w-0"
      aria-label={m.builder_wire_into({ name })}
      onclick={() => {
        wiring.into(picked);
      }}
    >
      <Cable data-icon="inline-start" />
      <span class="size-2.5 shrink-0 rounded-sm" style:background={stringCss(picked)}></span>
      <span class="truncate">{name}</span>
    </Button>
  {:else}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button {...props} class="min-h-11 shrink-0">
            <Cable data-icon="inline-start" />
            {m.builder_wire()}
            <ChevronDown data-icon="inline-end" />
          </Button>
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
</div>
{#if wiring.refused !== undefined}
  <p role="alert" class="border-b border-border/60 px-3 py-2 text-sm text-destructive">
    {wiring.refused}
  </p>
{/if}
