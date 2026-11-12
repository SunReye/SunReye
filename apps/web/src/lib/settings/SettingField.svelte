<script lang="ts">
  import type { Core, Setting } from "../api/core";
  import { editable } from "../components/value-editor/editable.ts";
  import ValueEditor from "../components/value-editor/value-editor.svelte";
  import { editorOutcome, OUTCOMES } from "./outcomes";

  let {
    core,
    device,
    setting,
    writes,
    onwritten,
  }: {
    core: Core;
    device: number;
    setting: Setting;
    /** The device's writes switch (ADR 7). */
    writes: boolean;
    onwritten: () => void;
  } = $props();

  const edit = $derived(editable(setting));

  // The device's switch, and trust once verified or enabled (ADR 8).
  const writable = $derived(writes && (setting.enable === "verified" || setting.enable === "on"));

  let row = $state<HTMLButtonElement | null>(null);
  let open = $state(false);

  /** The last value read back this session; the core has no read of a setting yet. */
  let current = $state<number | null>(null);

  /** What the last confirmed write did; the editor has closed by then. */
  let status = $state<string>();

  const currentText = $derived.by(() => {
    if (current === null) return "";

    if (edit.kind === "enum") return edit.options.find((o) => o.value === current)?.text ?? "";

    return edit.unit ? `${current} ${edit.unit}` : String(current);
  });

  async function write(value: number) {
    const result = await core.write(device, setting.key, value);

    onwritten();

    const outcome = editorOutcome(result);

    if (!("problem" in result)) {
      current = result.after ?? current;

      if (outcome.kind === "confirmed") status = OUTCOMES[result.outcome]();
    }

    return outcome;
  }
</script>

<div class="field">
  <button
    bind:this={row}
    type="button"
    aria-haspopup="dialog"
    disabled={!writable}
    onclick={() => {
      status = undefined;
      open = true;
    }}
  >
    <span>{edit.name}</span>
    <span class="value">{currentText}</span>
  </button>
  {#if status}
    <p role="status">{status}</p>
  {/if}
  <ValueEditor key={setting.key} {edit} {current} anchor={row} bind:open onapply={write} />
</div>

<style>
  .field {
    display: grid;
    gap: 0.25rem;
  }

  button {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 0.75rem;
    text-align: left;
  }

  .value {
    font-variant-numeric: tabular-nums;
  }

  p {
    margin: 0;
  }
</style>
