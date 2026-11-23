<script lang="ts">
  import type { Core, SharedArchive } from "../api/core";
  import * as ToggleGroup from "@sunreye/ui/toggle-group";
  import { m } from "../paraglide/messages.js";
  import ImportUpload from "./ImportUpload.svelte";

  type V3Device = SharedArchive["devices"][number];

  interface Archive {
    readonly path: string;
    readonly label: string;
    readonly devices: readonly V3Device[];
  }

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

  const id = $props.id();

  // The archives under `/share`, then the uploaded one; an upload reads `/share` again.
  let archives = $derived.by(() => {
    const upload: readonly Archive[] =
      uploaded === undefined
        ? []
        : [{ path: "upload", label: m.import_uploaded(), devices: uploaded }];

    return core
      .importFiles()
      .then((files): readonly Archive[] => [
        ...("problem" in files ? [] : files.map((file) => ({ ...file, label: file.path }))),
        ...upload,
      ]);
  });

  function pick(options: readonly Archive[], next: string): void {
    const chosen = options.find((option) => option.path === next);

    if (chosen !== undefined) onchoose(chosen.path, chosen.devices);
  }
</script>

<div role="group" aria-labelledby="{id}-archive" class="flex flex-col gap-2 px-4">
  <span id="{id}-archive" class="text-sm font-medium">{m.import_archive()}</span>
  {#await archives then options}
    {#if options.length === 0}
      <p class="text-sm text-muted-foreground">{m.import_none_shared()}</p>
    {/if}
    <ToggleGroup.Root
      type="single"
      variant="outline"
      orientation="vertical"
      {disabled}
      class="w-full empty:hidden"
      bind:value={() => source ?? "", (next) => pick(options, next)}
    >
      {#each options as option (option.path)}
        <ToggleGroup.Item value={option.path} class="w-full justify-start px-3 font-normal">
          <span class="truncate">{option.label}</span>
        </ToggleGroup.Item>
      {/each}
    </ToggleGroup.Root>
  {/await}
  <ImportUpload {disabled} {onupload} />
</div>
