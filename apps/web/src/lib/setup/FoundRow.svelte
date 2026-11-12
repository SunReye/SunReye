<!-- A device a profile recognised: chosen from the start, named as the admin likes. -->
<script lang="ts">
  import { Checkbox } from "#lib/components/ui/checkbox/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { m } from "../paraglide/messages.js";
  import type { Choice } from "./choices.ts";
  import { FIELD } from "./fields.ts";

  let { choice }: { choice: Choice } = $props();

  const at = $derived({ host: choice.found.host, port: choice.found.port });
</script>

<li class="flex flex-col gap-3 px-4 py-3">
  <label class="flex cursor-pointer items-center gap-3">
    <Checkbox
      bind:checked={choice.chosen}
      aria-label={m.devices_confirm({ ...at, profile: choice.profile, unit: choice.unit })}
    />
    <span class="flex min-w-0 flex-col">
      <span class="truncate text-[15px] font-medium">{choice.profile}</span>
      <span class="text-xs text-muted-foreground tabular-nums">
        {m.devices_at({ ...at, unit: choice.unit })}
      </span>
    </span>
  </label>
  {#if choice.chosen}
    <label class={[FIELD, "pl-7"]}>
      {m.devices_device_name()}
      <Input
        required
        aria-label={m.devices_name({ profile: choice.profile })}
        bind:value={choice.name}
      />
    </label>
  {/if}
</li>
