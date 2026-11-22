<!-- Creates a token with a name and a scope; a refused draft stays for a fix. -->
<script lang="ts">
  import KeyRound from "@lucide/svelte/icons/key-round";
  import type { CreatedToken, Problem, Scope } from "../api/core";
  import { Input } from "#lib/components/ui/input/index.js";
  import Segmented from "../components/segmented.svelte";
  import { m } from "../paraglide/messages.js";
  import AccessForm from "./AccessForm.svelte";
  import { SCOPES } from "./scopes.ts";
  import { answered } from "../feedback.ts";

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

  async function submit(): Promise<void> {
    const answer = await add(name.trim(), scope);

    if ("problem" in answer) {
      refused = answered(answer);

      return;
    }

    refused = undefined;
    name = "";
    oncreated(answer);
  }
</script>

<AccessForm
  action={m.access_add_token()}
  icon={KeyRound}
  {refused}
  onsubmit={() => void submit()}
  {oncancel}
>
  <label class="flex flex-col gap-1.5 text-sm">
    {m.access_name()}
    <Input required autocomplete="off" placeholder="evcc" bind:value={name} />
  </label>
  <div class="flex flex-col gap-1.5 text-sm">
    <span id="access-scope">{m.access_scope()}</span>
    <div class="self-start">
      <Segmented
        options={[
          ["read", SCOPES.read()],
          ["admin", SCOPES.admin()],
        ]}
        value={scope}
        labelledby="access-scope"
        onchange={(next) => {
          scope = next;
        }}
      />
    </div>
  </div>
</AccessForm>
