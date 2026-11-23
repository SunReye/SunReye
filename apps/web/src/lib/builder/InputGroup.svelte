<!-- One MPPT input in the Strings group (ADR 20): the strings on it, or that it is free, and the
  warnings of the input itself. -->
<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import { wiredIn, type Draft } from "@sunreye/builder/builder/modules.ts";
  import StringRow from "./StringRow.svelte";
  import type { InputRows } from "./string-tree.ts";

  let {
    input,
    draft,
    onpick,
  }: {
    input: InputRows;
    draft: Draft;
    /** A string by its position in the layout. */
    onpick: (string: number) => void;
  } = $props();

  const uid = $props.id();
</script>

<div role="group" aria-labelledby={uid} class="pb-1">
  <h4 id={uid} class="px-4 pt-2 text-xs font-medium text-muted-foreground">
    {m.builder_input({ input: input.input })}
  </h4>
  {#each input.strings as { index, warnings } (index)}
    <StringRow
      name={draft.strings[index]?.name ?? ""}
      position={index}
      made={wiredIn(draft.scene, index)}
      {warnings}
      onclick={() => {
        onpick(index);
      }}
    />
  {:else}
    <p class="px-4 py-1.5 text-sm text-muted-foreground">{m.builder_input_free()}</p>
  {/each}
  {#each input.warnings as warning (warning)}
    <p role="status" class="px-4 pb-1.5 text-sm text-warning">{warning}</p>
  {/each}
</div>
