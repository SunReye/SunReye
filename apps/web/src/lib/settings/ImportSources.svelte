<script lang="ts">
  import Upload from "@lucide/svelte/icons/upload";
  import type { Core, SharedArchive } from "../api/core";
  import { buttonVariants } from "#lib/components/ui/button/index.js";
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import { cn } from "#lib/utils.js";
  import { m } from "../paraglide/messages.js";

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

  let shared = $derived(core.importFiles());

  function archives(files: Awaited<ReturnType<Core["importFiles"]>>): Archive[] {
    const listed = "problem" in files ? [] : files.map((file) => ({ ...file, label: file.path }));

    return uploaded === undefined
      ? listed
      : [...listed, { path: "upload", label: m.import_uploaded(), devices: uploaded }];
  }
</script>

<div role="group" aria-labelledby="{id}-archive" class="flex flex-col gap-2 px-4">
  <span id="{id}-archive" class="text-sm font-medium">{m.import_archive()}</span>
  {#await shared then files}
    {@const options = archives(files)}
    {#if options.length > 0}
      <ToggleGroup.Root
        type="single"
        variant="outline"
        orientation="vertical"
        {disabled}
        class="w-full"
        bind:value={
          () => source ?? "",
          (next) => {
            const chosen = options.find((option) => option.path === next);

            if (chosen !== undefined) onchoose(chosen.path, chosen.devices);
          }
        }
      >
        {#each options as option (option.path)}
          <ToggleGroup.Item value={option.path} class="w-full justify-start px-3 font-normal">
            <span class="truncate">{option.label}</span>
          </ToggleGroup.Item>
        {/each}
      </ToggleGroup.Root>
    {/if}
    {#if "problem" in files || files.length === 0}
      <p class="text-sm text-muted-foreground">{m.import_none_shared()}</p>
    {/if}
  {/await}
  <!-- The file input is hidden behind the ui button; the label keeps it named and focusable. -->
  <label
    class={cn(
      buttonVariants({ variant: "outline", size: "sm" }),
      "self-start has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50 has-disabled:pointer-events-none has-disabled:opacity-50",
    )}
  >
    <Upload data-icon="inline-start" />
    {m.import_upload()}
    <input
      type="file"
      class="sr-only"
      accept=".tar.gz,application/gzip"
      {disabled}
      onchange={(event) => {
        const file = event.currentTarget.files?.[0];

        if (file !== undefined) onupload(file);
      }}
    />
  </label>
</div>
