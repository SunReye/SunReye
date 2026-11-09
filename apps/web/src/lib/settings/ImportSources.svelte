<script lang="ts">
  import type { Core, SharedArchive } from "../api/core";
  import { m } from "../paraglide/messages.js";

  type V3Device = SharedArchive["devices"][number];

  let {
    core,
    uploaded,
    source,
    disabled,
    onchoose,
    onupload,
  }: {
    core: Core;
    /** The uploaded archive's devices, once one is. */
    uploaded: readonly V3Device[] | undefined;
    /** The chosen source: a path under `/share`, or `upload` for the uploaded archive. */
    source: string | undefined;
    disabled: boolean;
    onchoose: (source: string, devices: readonly V3Device[]) => void;
    onupload: (file: File) => void;
  } = $props();

  let shared = $derived(core.importFiles());
</script>

<fieldset {disabled}>
  <legend>{m.import_archive()}</legend>
  {#await shared then files}
    {#each "problem" in files ? [] : files as file (file.path)}
      {@render option(file.path, file.path, file.devices)}
    {:else}
      <p>{m.import_none_shared()}</p>
    {/each}
  {/await}
  {#if uploaded !== undefined}
    {@render option("upload", m.import_uploaded(), uploaded)}
  {/if}
  <label>
    {m.import_upload()}
    <input
      type="file"
      accept=".tar.gz,application/gzip"
      onchange={(event) => {
        const file = event.currentTarget.files?.[0];

        if (file !== undefined) onupload(file);
      }}
    />
  </label>
</fieldset>

{#snippet option(path: string, label: string, devices: readonly V3Device[])}
  <label>
    <input
      type="radio"
      name="import-source"
      checked={source === path}
      onchange={() => {
        onchoose(path, devices);
      }}
    />{label}
  </label>
{/snippet}

<style>
  fieldset {
    display: grid;
    gap: 0.5rem;
    justify-items: start;
  }
</style>
