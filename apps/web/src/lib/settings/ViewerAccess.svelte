<!-- Settings › Users & access › Viewers: accounts that read, each with a name and a password (ADR 9). -->
<script lang="ts">
  import UserPlus from "@lucide/svelte/icons/user-plus";
  import { onMount } from "svelte";
  import type { Core, Problem, Viewer } from "../api/core";
  import { Input } from "#lib/components/ui/input/index.js";
  import { m } from "../paraglide/messages.js";
  import AccessForm from "./AccessForm.svelte";
  import AccessRow from "./AccessRow.svelte";
  import AccessSection from "./AccessSection.svelte";

  let { core }: { core: Core } = $props();

  let viewers = $state.raw<readonly Viewer[] | Problem>();
  let name = $state("");
  let password = $state("");
  let refused = $state.raw<Problem>();

  async function reload(): Promise<void> {
    viewers = await core.viewers();
  }

  onMount(() => {
    void reload();
  });

  // A refused draft stays in the form for a fix.
  async function add(close: () => void): Promise<void> {
    const answer = await core.addViewer(name.trim(), password);

    if ("problem" in answer) {
      refused = answer;

      return;
    }

    refused = undefined;
    name = "";
    password = "";
    close();
    await reload();
  }

  async function remove(id: number): Promise<Problem | undefined> {
    const problem = await core.removeViewer(id);

    if (problem === undefined) await reload();

    return problem;
  }
</script>

<AccessSection
  id="access-viewers"
  title={m.access_viewers()}
  hint={m.access_viewers_hint()}
  answer={viewers}
  action={m.access_add_viewer()}
>
  {#snippet row(viewer)}
    <AccessRow
      name={viewer.name}
      ask={m.access_remove_viewer({ name: viewer.name })}
      note={m.access_remove_viewer_note({ name: viewer.name })}
      confirm={m.access_remove()}
      onremove={() => remove(viewer.id)}
    />
  {/snippet}
  {#snippet form(close)}
    <AccessForm
      action={m.access_add_viewer()}
      icon={UserPlus}
      {refused}
      onsubmit={() => void add(close)}
      oncancel={() => {
        refused = undefined;
        close();
      }}
    >
    <label class="flex flex-col gap-1.5 text-sm">
      {m.access_name()}
      <Input required autocomplete="off" bind:value={name} />
    </label>
    <label class="flex flex-col gap-1.5 text-sm">
      {m.access_password()}
      <Input type="password" required autocomplete="new-password" bind:value={password} />
    </label>
    </AccessForm>
  {/snippet}
</AccessSection>
