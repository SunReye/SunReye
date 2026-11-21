<!--
  Sign-in (ADR 9, 21): one glass card on the backdrop. The admin signs in with the password alone,
  a viewer with their name beside it.
-->
<script lang="ts">
  import TextField from "../components/text-field.svelte";
  import PageTitle from "../components/page-title.svelte";
  import * as Card from "#lib/components/ui/card/index.js";
  import type { Core, Problem } from "../api/core.ts";
  import { Button } from "#lib/components/ui/button/index.js";
  import { haptics } from "../haptics.ts";
  import LocaleSwitch from "../LocaleSwitch.svelte";
  import { m } from "../paraglide/messages.js";
  import AccountSwitch from "./AccountSwitch.svelte";
  import Refusal, { answered } from "./Refusal.svelte";

  let { core, onsignedin }: { core: Core; onsignedin: () => void } = $props();

  let account = $state<"admin" | "viewer">("admin");

  let name = $state("");

  let password = $state("");

  let refused = $state.raw<Problem>();

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    haptics.light();
    refused = answered(await core.signIn(password, account === "viewer" ? name.trim() : undefined));

    if (refused === undefined) onsignedin();
  }
</script>

<main class="grid min-h-dvh place-items-center px-4 py-10">
  <div class="flex w-full max-w-sm flex-col gap-5">
    <PageTitle brand class="px-1" title={m.signin_title()} />
    <Card.Root element="form" onsubmit={submit} class="gap-4 p-4">
      <AccountSwitch bind:account />
      {#if account === "viewer"}
        <TextField label={m.signin_name()} autocomplete="username" required bind:value={name} />
      {/if}
      <TextField
        label={m.password_label()}
        type="password" autocomplete="current-password" required bind:value={password}
      />
      <Refusal {refused} />
      <Button type="submit" class="w-full">
        {m.signin_submit()}
      </Button>
    </Card.Root>
    <div class="flex justify-center"><LocaleSwitch /></div>
  </div>
</main>
