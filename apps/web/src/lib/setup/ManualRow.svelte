<!-- A host no profile recognised, or one entered by hand: its device's profile, unit and name, once the admin adds it. -->
<script lang="ts">
  import TextField from "../components/text-field.svelte";
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import { Button } from "@sunreye/ui/button";
  import type { Core } from "../api/core.ts";
  import ValueRow from "../builder/ValueRow.svelte";
  import { m } from "../paraglide/messages.js";
  import type { Choice } from "./choices.ts";
  import { FIELD } from "./fields.ts";
  import ProfilePicker from "./ProfilePicker.svelte";

  let { core, choice, note }: { core: Core; choice: Choice; note: string } = $props();

  const at = $derived({ host: choice.found.host, port: choice.found.port });

  // A Modbus unit address.
  const unit = $derived({
    kind: "number" as const,
    name: m.devices_manual_unit(at),
    unit: "",
    min: 0,
    max: 247,
    step: 1,
  });
</script>

<li class="flex flex-col gap-3 px-4 py-3">
  <div class="flex items-center gap-3">
    <span class="flex min-w-0 flex-col">
      <span class="truncate text-[15px] font-medium tabular-nums">{at.host}:{at.port}</span>
      <span class="text-xs text-muted-foreground">{note}</span>
    </span>
    {#if choice.chosen}
      <Button
        variant="ghost"
        size="icon-sm"
        class="ml-auto"
        aria-label={m.devices_manual_drop(at)}
        onclick={() => {
          choice.chosen = false;
        }}
      >
        <X />
      </Button>
    {:else}
      <Button
        variant="outline"
        size="sm"
        class="ml-auto"
        aria-label={m.devices_manual(at)}
        onclick={() => {
          choice.chosen = true;
        }}
      >
        <Plus data-icon="inline-start" />
        {m.devices_manual_short()}
      </Button>
    {/if}
  </div>
  {#if choice.chosen}
    <div class={FIELD}>
      <span>{m.devices_profile()}</span>
      <ProfilePicker
        {core}
        value={choice.profile}
        variant={choice.variant}
        label={m.devices_manual_profile(at)}
        onpick={(profile, variant) => {
          choice.profile = profile;
          choice.variant = variant;
        }}
      />
    </div>
    <div class="overflow-hidden rounded-md border border-border/60">
      <ValueRow
        edit={unit}
        value={choice.unit}
        onchange={(next) => {
          choice.unit = next;
        }}
      />
    </div>
    <TextField
      label={m.devices_device_name()}
      required
      autocomplete="off"
      aria-label={m.devices_manual_name(at)}
      bind:value={choice.name}
    />
  {/if}
</li>
