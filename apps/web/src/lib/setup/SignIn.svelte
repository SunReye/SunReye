<script lang="ts">
  import type { Core, Problem } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import Refusal from "./Refusal.svelte";

  let { core, onsignedin }: { core: Core; onsignedin: () => void } = $props();

  let password = $state("");

  let refused = $state.raw<Problem>();

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    refused = await core.signIn(password);

    if (refused === undefined) onsignedin();
  }
</script>

<main>
  <h1>{m.signin_title()}</h1>
  <form onsubmit={submit}>
    <label>
      {m.password_label()}
      <input type="password" autocomplete="current-password" required bind:value={password} />
    </label>
    <button type="submit">{m.signin_submit()}</button>
  </form>
  <Refusal {refused} />
</main>
