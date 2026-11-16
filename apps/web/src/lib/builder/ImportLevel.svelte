<!--
  The imported surroundings' level in the inspector (ADR 20): loading them, and once loaded their
  exact place and turn, the buildings hidden, loading anew and removing them.
-->
<script lang="ts">
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Item from "#lib/components/ui/item/index.js";
  import { m } from "../paraglide/messages.js";
  import { degrees, metres, REACH } from "./fields.ts";
  import ImportLoad from "./ImportLoad.svelte";
  import type { Scene } from "./pv.ts";
  import RemoveButton from "./RemoveButton.svelte";
  import ValueRow from "./ValueRow.svelte";

  let {
    scene,
    onchange,
    onremove,
  }: {
    scene: Scene;
    onchange: (scene: Scene) => void;
    /** The scene without the surroundings. */
    onremove: (scene: Scene) => void;
  } = $props();

  const place = [
    ["x", metres(m.field_x(), -REACH, REACH)],
    ["z", metres(m.field_z(), -REACH, REACH)],
    // Finer than a handle's 5°: a turn that lines a building up is seldom a whole degree.
    ["turn", { ...degrees(m.builder_import_turn(), 0, 359.9), step: 0.1 }],
  ] as const;

  /** "Neu laden" was chosen: the load's form shows over the loaded surroundings. */
  let reloading = $state(false);

  const imported = $derived(scene.imported ?? undefined);
  const hidden = $derived(imported?.hidden?.length ?? 0);
</script>

{#if imported === undefined || reloading}
  <ImportLoad
    again={imported !== undefined}
    ondone={() => {
      reloading = false;
    }}
  />
{:else}
  <p class="px-4 pt-3 pb-2 text-sm text-muted-foreground">{m.builder_import_hint()}</p>
  <Item.Group class="gap-0 divide-y divide-border/60">
    {#each place as [key, edit] (key)}
      <ValueRow
        {edit}
        value={imported[key]}
        onchange={(value) => {
          onchange({ ...scene, imported: { ...imported, [key]: value } });
        }}
      />
    {/each}
    <Item.Root class="rounded-none border-0">
      <Item.Content>
        <Item.Title class="text-[15px] font-normal">{m.builder_import_hidden()}</Item.Title>
      </Item.Content>
      <Item.Actions class="gap-3">
        <span class="text-[15px] font-medium tabular-nums">{hidden}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={hidden === 0}
          onclick={() => {
            onchange({ ...scene, imported: { ...imported, hidden: [] } });
          }}
        >
          {m.builder_import_show_all()}
        </Button>
      </Item.Actions>
    </Item.Root>
  </Item.Group>
  <div class="border-t border-border/60 px-3 pt-3">
    <Button
      variant="outline"
      class="w-full"
      onclick={() => {
        reloading = true;
      }}
    >
      <RefreshCw data-icon="inline-start" />
      {m.builder_import_reload()}
    </Button>
  </div>
  <RemoveButton
    onremove={() => {
      onremove({ ...scene, imported: null });
    }}
  />
{/if}
