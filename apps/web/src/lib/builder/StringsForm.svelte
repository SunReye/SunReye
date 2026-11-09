<script lang="ts">
  import type { ModuleType } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { addString, painted, withoutString, type Draft } from "./modules.ts";
  import StringFieldset from "./StringFieldset.svelte";

  let {
    draft,
    moduleTypes,
    moduleType,
    onchange,
  }: {
    draft: Draft;
    moduleTypes: readonly ModuleType[];
    /** A new string's; without one no string can be added. */
    moduleType: number | undefined;
    onchange: (draft: Draft) => void;
  } = $props();
</script>

<h2>{m.builder_strings()}</h2>
{#each draft.strings as string, i (string.id ?? `new ${i}`)}
  <StringFieldset
    {string}
    position={i}
    made={painted(draft.scene, i)}
    {moduleTypes}
    onchange={(next) => {
      onchange({ ...draft, strings: draft.strings.with(i, next) });
    }}
    onremove={() => {
      onchange({ scene: withoutString(draft.scene, i), strings: draft.strings.toSpliced(i, 1) });
    }}
  />
{/each}
{#if moduleType !== undefined}
  <button
    type="button"
    onclick={() => {
      const name = m.builder_string_default({ number: draft.strings.length + 1 });

      onchange(addString(draft, name, moduleType));
    }}>{m.builder_add_string()}</button
  >
{/if}
