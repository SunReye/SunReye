<!-- Settings › Users & access › Tokens: bearer tokens for integrations, scoped read or admin (ADR 9). -->
<script lang="ts">
  import { onMount } from "svelte";
  import type { Core, CreatedToken, Problem, Token } from "../api/core";
  import { m } from "../paraglide/messages.js";
  import AccessRow from "./AccessRow.svelte";
  import AccessSection from "./AccessSection.svelte";
  import NewToken from "./NewToken.svelte";
  import { SCOPES } from "./scopes.ts";
  import TokenForm from "./TokenForm.svelte";

  let { core }: { core: Core } = $props();

  let tokens = $state.raw<readonly Token[] | Problem>();

  /** The token just created, shown until the admin is done with it. */
  let created = $state.raw<CreatedToken>();

  async function reload(): Promise<void> {
    tokens = await core.tokens();
  }

  onMount(() => {
    void reload();
  });

  async function remove(id: number): Promise<Problem | undefined> {
    const problem = await core.removeToken(id);

    if (problem === undefined) await reload();

    return problem;
  }
</script>

<AccessSection
  id="access-tokens"
  title={m.access_tokens()}
  hint={m.access_tokens_hint()}
  answer={tokens}
  action={m.access_add_token()}
>
  {#snippet row(token)}
    <AccessRow
      name={token.name}
      detail={SCOPES[token.scope]()}
      ask={m.access_revoke_token({ name: token.name })}
      note={m.access_revoke_token_note({ name: token.name })}
      confirm={m.access_revoke()}
      done={m.access_revoked()}
      onremove={() => remove(token.id)}
    />
  {/snippet}
  {#snippet form(close)}
    {#if created}
      <NewToken
        {created}
        ondone={() => {
          created = undefined;
          close();
        }}
      />
    {:else}
      <TokenForm
        add={(name, scope) => core.addToken(name, scope)}
        oncreated={(answer) => {
          created = answer;
          void reload();
        }}
        oncancel={close}
      />
    {/if}
  {/snippet}
</AccessSection>
