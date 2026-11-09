<script lang="ts">
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

  async function send(file: File | undefined): Promise<void> {
    if (file === undefined) return;

    const stored = await upload(file);

    if (stored instanceof Object) {
      refused = problemText(stored.problem);

      return;
    }

    refused = undefined;
    onchange(stored);
  }
</script>

{#if model === undefined || model === null}
  <label>
    {m.car_upload()}
    <input
      type="file"
      accept=".glb,model/gltf-binary"
      onchange={(event) => {
        void send(event.currentTarget.files?.[0]);
      }}
    />
  </label>
{:else}
  <button
    type="button"
    onclick={() => {
      onchange(null);
    }}>{m.car_model_remove()}</button
  >
{/if}
{#if refused !== undefined}
  <p role="alert">{refused}</p>
{/if}

<style>
  label {
    display: grid;
    gap: 0.25rem;
    font-size: 0.875rem;
  }
</style>
