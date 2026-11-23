<script lang="ts">
  import type { Core, SharedArchive } from "../api/core";
  import * as Item from "@sunreye/ui/item";
  import LoadingRows from "../components/loading-rows.svelte";
  import { m } from "../paraglide/messages.js";
  import ImportDevice from "./ImportDevice.svelte";

  let {
    core,
    archive,
    mapping = $bindable(),
    disabled,
  }: {
    core: Core;
    /** The chosen archive's v3 devices. */
    archive: readonly SharedArchive["devices"][number][];
    /** The v5 device id each v3 slug maps to; empty when it is not imported. */
    mapping: Record<string, string>;
    disabled: boolean;
  } = $props();

  const id = $props.id();

  /** Skipping, then the v5 devices to map them to. */
  async function read(): Promise<{ value: string; label: string }[]> {
    const answer = await core.devices();

    return [
      { value: "", label: m.import_skip() },
      ...("problem" in answer ? [] : answer).map((target) => ({
        value: String(target.id),
        label: m.import_device({ name: target.name, id: target.id }),
      })),
    ];
  }

  let choices = $derived.by(read);
</script>

<div role="group" aria-labelledby="{id}-devices" class="flex flex-col">
  <span id="{id}-devices" class="px-4 text-sm font-medium">{m.import_devices()}</span>
  {#await choices}
    <LoadingRows rows={archive.length} />
  {:then listed}
    <Item.Group class="gap-0 divide-y divide-border/60">
      {#each archive as device (device.slug)}
        <ImportDevice
          slug={device.slug}
          choices={listed}
          bind:value={() => mapping[device.slug] ?? "", (next) => (mapping[device.slug] = next)}
          {disabled}
        />
      {/each}
    </Item.Group>
  {/await}
</div>
