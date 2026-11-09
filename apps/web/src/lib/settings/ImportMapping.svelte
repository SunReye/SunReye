<script lang="ts">
  import type { Core, SharedArchive } from "../api/core";
  import { m } from "../paraglide/messages.js";

  let {
    core,
    archive,
    mapping = $bindable(),
    disabled,
    onstart,
  }: {
    core: Core;
    /** The chosen archive's v3 devices. */
    archive: readonly SharedArchive["devices"][number][];
    /** The v5 device id each v3 slug maps to; empty when it is not imported. */
    mapping: Record<string, string>;
    disabled: boolean;
    onstart: () => void;
  } = $props();

  // The v5 devices to map them to.
  let targets = $derived(core.devices());
</script>

<fieldset {disabled}>
  <legend>{m.import_devices()}</legend>
  {#each archive as device (device.slug)}
    <label>
      {device.slug}
      <select bind:value={mapping[device.slug]}>
        <option value="">{m.import_skip()}</option>
        {#await targets then answer}
          {#each "problem" in answer ? [] : answer as target (target.id)}
            <option value={String(target.id)}>
              {m.import_device({ name: target.name, id: target.id })}
            </option>
          {/each}
        {/await}
      </select>
    </label>
  {/each}
  <button type="button" onclick={onstart}>{m.import_start()}</button>
</fieldset>

<style>
  fieldset {
    display: grid;
    gap: 0.5rem;
    justify-items: start;
  }
</style>
