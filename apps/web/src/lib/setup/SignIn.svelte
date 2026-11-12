<!--
  Sign-in (ADR 9, 21): one glass card on the backdrop. The admin signs in with the password alone,
  a viewer with their name beside it.
-->
<script lang="ts">
  import type { Core, Problem } from "../api/core.ts";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import SunMark from "../components/sun-mark.svelte";
  import { haptics } from "../haptics.ts";
  import LocaleSwitch from "../LocaleSwitch.svelte";
  import { m } from "../paraglide/messages.js";
  import AccountSwitch from "./AccountSwitch.svelte";
  import { FIELD } from "./fields.ts";
  import Refusal from "./Refusal.svelte";

  let { core, onsignedin }: { core: Core; onsignedin: () => void } = $props();

  let account = $state<"admin" | "viewer">("admin");

  let name = $state("");

  let password = $state("");

  let refused = $state.raw<Problem>();

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    haptics.light();
    refused = await core.signIn(password, account === "viewer" ? name.trim() : undefined);

    if (refused === undefined) onsignedin();
  }
</script>

<main class="grid min-h-dvh place-items-center px-4 py-10">
  <div class="flex w-full max-w-sm flex-col gap-5">
    <header class="flex items-center gap-3 px-1">
      <SunMark class="size-8" />
      <h1 class="text-2xl font-semibold tracking-tight">{m.signin_title()}</h1>
    </header>
    <form
      onsubmit={submit}
      class="glass-ambient flex flex-col gap-4 rounded-lg border border-border/60 p-4 elevation-2"
    >
      <AccountSwitch bind:account />
      {#if account === "viewer"}
        <label class={FIELD}>
          {m.signin_name()}
          <Input autocomplete="username" required bind:value={name} />
        </label>
      {/if}
      <label class={FIELD}>
        {m.password_label()}
        <Input type="password" autocomplete="current-password" required bind:value={password} />
      </label>
      <Refusal {refused} />
      <Button type="submit" class="w-full">
        {m.signin_submit()}
      </Button>
    </form>
    <div class="flex justify-center"><LocaleSwitch /></div>
  </div>
</main>
