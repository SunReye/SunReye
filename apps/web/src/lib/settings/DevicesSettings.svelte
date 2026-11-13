<!-- Settings › Devices: each device with its profile, and the profile updates waiting for the admin. -->
<script lang="ts">
  import type { Core } from "../api/core";
  import * as Item from "#lib/components/ui/item/index.js";
  import LoadingRows from "../components/loading-rows.svelte";
  import { problemText } from "../i18n/problems";
  import ProfileUpdates from "./ProfileUpdates.svelte";

  let { core }: { core: Core } = $props();

  const devices = $derived(core.devices());
</script>

{#await devices}
  <LoadingRows />
{:then answer}
  {#if "problem" in answer}
    <p role="alert" class="p-4">{problemText(answer.problem)}</p>
  {:else}
    <Item.Group class="gap-0 divide-y divide-border/60">
      {#each answer as device (device.id)}
        <Item.Root class="rounded-none border-0">
          <Item.Content>
            <Item.Title class="text-[15px] font-normal">{device.name}</Item.Title>
            <Item.Description>{device.profile}</Item.Description>
          </Item.Content>
        </Item.Root>
      {/each}
    </Item.Group>
  {/if}
{/await}
<div class="border-t border-border/60 p-4">
  <ProfileUpdates {core} onapplied={() => undefined} />
</div>
