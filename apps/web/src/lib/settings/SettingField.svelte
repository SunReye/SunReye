<script lang="ts">
  import type { Attempt, Core, Problem, Setting } from "../api/core";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";
  import { valueText } from "./bounds";
  import { OUTCOMES } from "./outcomes";

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

  const id = $props.id();

  // An enumerated setting starts at its first value; a ranged one waits for the admin's.
  let value = $derived<number | null>(setting.values?.[0] ?? null);

  // The device's switch, and trust once verified or enabled (ADR 8).
  const writable = $derived(writes && (setting.enable === "verified" || setting.enable === "on"));
  let pending = $state(false);
  let result = $state.raw<Attempt | Problem>();

  async function write(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (value === null) return;

    pending = true;
    result = await core.write(device, setting.key, value);
    pending = false;
    onwritten();
  }
</script>

<form onsubmit={write}>
  <label for={id}>{setting.key}</label>
  {#if setting.values}
    <select {id} bind:value>
      {#each setting.values as option (option)}
        <option value={option}>{valueText(option, setting.labels)}</option>
      {/each}
    </select>
  {:else}
    <input
      {id}
      type="number"
      min={setting.range?.min}
      max={setting.range?.max}
      step={setting.step}
      required
      bind:value
    />
  {/if}
  <button disabled={!writable || pending}>{m.settings_write({ key: setting.key })}</button>
  {#if result !== undefined && "problem" in result}
    <p role="alert">{problemText(result.problem)}</p>
  {:else if result !== undefined}
    <p role="status">
      {OUTCOMES[result.outcome]()}
      {#if result.failedStep}
        {m.settings_failed_step({ step: result.failedStep })}
      {/if}
    </p>
  {/if}
</form>

<style>
  form {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  p {
    flex-basis: 100%;
    margin: 0;
  }
</style>
