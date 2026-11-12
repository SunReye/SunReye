<!-- Setup's first step: the admin password, typed twice; the admin is signed in with it at once. -->
<script lang="ts">
  import type { Core, Problem } from "../api/core.ts";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import { FIELD } from "./fields.ts";
  import Refusal from "./Refusal.svelte";

  let { core, ondone }: { core: Core; ondone: () => void } = $props();

  let password = $state("");

  let repeated = $state("");

  let refused = $state.raw<Problem>();

  let mismatch = $state.raw<string>();

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    mismatch = password === repeated ? undefined : m.password_mismatch();

    if (mismatch !== undefined) {
      haptics.error();

      return;
    }

    // Setting the password signs no one in; the admin signs in with it at once.
    refused = (await core.setPassword(password)) ?? (await core.signIn(password));

    if (refused === undefined) ondone();
  }
</script>

<form onsubmit={submit} class="flex flex-col gap-4 p-4">
  <p class="text-sm text-muted-foreground">{m.password_hint()}</p>
  <label class={FIELD}>
    {m.password_label()}
    <Input type="password" autocomplete="new-password" required bind:value={password} />
  </label>
  <label class={FIELD}>
    {m.password_repeat()}
    <Input type="password" autocomplete="new-password" required bind:value={repeated} />
  </label>
  <Refusal {refused} text={mismatch} />
  <Button type="submit" class="w-full sm:w-auto sm:self-end">{m.password_set()}</Button>
</form>
