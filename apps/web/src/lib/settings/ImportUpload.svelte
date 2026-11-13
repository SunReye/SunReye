<!-- The archive upload as a ui button; the label keeps the hidden file input named and focusable. -->
<script lang="ts">
  import Upload from "@lucide/svelte/icons/upload";
  import { buttonVariants } from "#lib/components/ui/button/index.js";
  import { cn } from "#lib/utils.js";
  import { m } from "../paraglide/messages.js";

  let { disabled, onupload }: { disabled: boolean; onupload: (file: File) => void } = $props();
</script>

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
