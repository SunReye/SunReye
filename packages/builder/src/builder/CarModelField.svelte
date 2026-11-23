<!-- A car place's own body: upload a GLB, or drop it for the default. -->
<script lang="ts">
  import ProblemAlert from "../components/problem-alert.svelte";
  import Upload from "@lucide/svelte/icons/upload";
  import X from "@lucide/svelte/icons/x";
  import * as Item from "@sunreye/ui/item";
  import { Button } from "@sunreye/ui/button";
  import { Input } from "@sunreye/ui/input";
  import { problemText } from "../i18n/problems.ts";
  import { m } from "../paraglide/messages.js";
  import { uploader } from "./upload.ts";

  let {
    model,
    onchange,
  }: {
    /** The uploaded body's id, if any. */
    model: string | null | undefined;
    onchange: (model: string | null) => void;
  } = $props();

  const upload = uploader();

  let refused = $state<string>();
  let file = $state<HTMLElement | null>(null);

  async function send(chosen: File | undefined): Promise<void> {
    if (chosen === undefined) return;

    const stored = await upload(chosen);

    if (stored instanceof Object) {
      refused = problemText(stored.problem);

      return;
    }

    refused = undefined;
    onchange(stored);
  }
</script>

<Item.Root class="rounded-none border-0">
  <Item.Content>
    {#if model === undefined || model === null}
      <Button variant="outline" onclick={() => file?.click()}>
        <Upload data-icon="inline-start" />
        {m.car_upload()}
      </Button>
      <!-- The button is the control; the input only reads the file. -->
      <Input
        bind:ref={file}
        type="file"
        class="sr-only"
        tabindex={-1}
        aria-label={m.car_upload()}
        accept=".glb,model/gltf-binary"
        onchange={(event) => {
          void send(event.currentTarget.files?.[0]);
        }}
      />
    {:else}
      <Button
        variant="outline"
        onclick={() => {
          onchange(null);
        }}
      >
        <X data-icon="inline-start" />
        {m.car_model_remove()}
      </Button>
    {/if}
    <ProblemAlert text={refused} />
  </Item.Content>
</Item.Root>
