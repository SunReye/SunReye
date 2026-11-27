<!-- A marker kind in the wall spot's menu (ADR 20): one device, one tap; several, a menu of them
  to say which the marker names. -->
<script lang="ts">
  import * as DropdownMenu from "@sunreye/ui/dropdown-menu";
  import type { Device } from "./host.ts";
  import type { Equipment } from "./pv.ts";
  import type { WallAdd } from "./wall-actions.ts";

  let {
    marker,
    name,
    devices,
    onadd,
  }: {
    marker: Equipment["kind"];
    name: string;
    devices: readonly Readonly<Device>[];
    onadd: (add: WallAdd) => void;
  } = $props();

  const [only] = $derived(devices.length === 1 ? devices : []);
</script>

{#if only !== undefined}
  <DropdownMenu.Item
    class="min-h-11"
    onSelect={() => {
      onadd({ marker, device: only.id });
    }}
  >
    {name}
  </DropdownMenu.Item>
{:else}
  <DropdownMenu.Sub>
    <DropdownMenu.SubTrigger class="min-h-11">{name}</DropdownMenu.SubTrigger>
    <DropdownMenu.SubContent class="w-48">
      {#each devices as device (device.id)}
        <DropdownMenu.Item
          class="min-h-11"
          onSelect={() => {
            onadd({ marker, device: device.id });
          }}
        >
          {device.name}
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.SubContent>
  </DropdownMenu.Sub>
{/if}
