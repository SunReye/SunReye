<!-- Creates a token with a name and a scope; a refused draft stays for a fix. -->
<script lang="ts">
  import KeyRound from "@lucide/svelte/icons/key-round";
  import type { CreatedToken, Problem, Scope } from "../api/core";
  import { Input } from "#lib/components/ui/input/index.js";
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import { m } from "../paraglide/messages.js";
  import AccessForm from "./AccessForm.svelte";
  import { SCOPES } from "./scopes.ts";

  let {
    add,
    oncreated,
    oncancel,
  }: {
    add: (name: string, scope: Scope) => Promise<CreatedToken | Problem>;
    oncreated: (created: CreatedToken) => void;
    oncancel: () => void;
  } = $props();

  let name = $state("");
  let scope = $state<Scope>("read");
  let refused = $state.raw<Problem>();

  function choose(next: string): void {
    if (next === "read" || next === "admin") scope = next;
  }

  async function submit(): Promise<void> {
    const answer = await add(name.trim(), scope);

    if ("problem" in answer) {
      refused = answer;

      return;
    }

    refused = undefined;
    name = "";
    oncreated(answer);
  }
</script>

<AccessForm action={m.access_add_token()} icon={KeyRound} {refused} onsubmit={() => void submit()} {oncancel}>
  <label class="flex flex-col gap-1.5 text-sm">
    {m.access_name()}
    <Input required autocomplete="off" placeholder="evcc" bind:value={name} />
  </label>
  <div class="flex flex-col gap-1.5 text-sm">
    <span id="access-scope">{m.access_scope()}</span>
    <ToggleGroup.Root
      type="single"
      variant="outline"
      bind:value={() => scope, choose}
      aria-labelledby="access-scope"
      class="self-start"
    >
      {#each Object.entries(SCOPES) as [value, label] (value)}
        <ToggleGroup.Item {value} class="px-4">{label()}</ToggleGroup.Item>
      {/each}
    </ToggleGroup.Root>
  </div>
</AccessForm>
