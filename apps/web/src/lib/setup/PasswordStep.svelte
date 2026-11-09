<script lang="ts">
  import type { Core, Problem } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import Refusal from "./Refusal.svelte";

  let { core, ondone }: { core: Core; ondone: () => void } = $props();

  let password = $state("");

  let repeated = $state("");

  let refused = $state.raw<Problem>();

  let mismatch = $state(false);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    mismatch = password !== repeated;

    if (mismatch) return;

    // Setting the password signs no one in; the admin signs in with it at once.
    refused = (await core.setPassword(password)) ?? (await core.signIn(password));

    if (refused === undefined) ondone();
  }
</script>

<form onsubmit={submit}>
  <label>
    {m.password_label()}
    <input type="password" autocomplete="new-password" required bind:value={password} />
  </label>
  <label>
    {m.password_repeat()}
    <input type="password" autocomplete="new-password" required bind:value={repeated} />
  </label>
  <button type="submit">{m.password_set()}</button>
</form>
{#if mismatch}
  <p role="alert">{m.password_mismatch()}</p>
{:else}
  <Refusal {refused} />
{/if}
