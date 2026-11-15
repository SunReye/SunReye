<!-- An inspector row choosing a finish's colour: its own, a common one, or any (ADR 20). -->
<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import * as Item from "#lib/components/ui/item/index.js";
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import { m } from "../paraglide/messages.js";
  import type { Swatch } from "./colours.ts";
  import HexField from "./HexField.svelte";

  let {
    label,
    swatches,
    own,
    value,
    onchange,
  }: {
    label: string;
    swatches: readonly Swatch[];
    /** The finish's untinted look, shown on the default swatch. */
    own: string;
    /** `#rrggbb`; the finish's own without one. */
    value: string | null | undefined;
    /** Null for the finish's own. */
    onchange: (colour: string | null) => void;
  } = $props();

  /** The default swatch's value in the group: no colour is one. */
  const OWN = "own";

  const current = $derived(value ?? null);
  const custom = $derived(current !== null && !swatches.some(([colour]) => colour === current));

  const choices = $derived<readonly (readonly [string, string, string])[]>([
    [OWN, own, m.colour_default()],
    ...swatches.map(([colour, name]) => [colour, colour, name()] as const),
  ]);
</script>

<Item.Root class="flex-col items-stretch gap-2 rounded-none border-0">
  <Item.Title class="text-[15px] font-normal">{label}</Item.Title>
  <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
    <!-- No swatch is pressed under a colour of the admin's own; a second tap on one keeps it. -->
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      spacing={1}
      class="flex-wrap"
      bind:value={
        () => (custom ? "" : (current ?? OWN)),
        (picked) => {
          if (picked !== "") onchange(picked === OWN ? null : picked);
        }
      }
    >
      {#each choices as [choice, paint, name] (choice)}
        <ToggleGroup.Item value={choice} aria-label={name} title={name} class="size-11 p-0">
          <span
            class="grid size-7 place-items-center rounded-sm ring-1 ring-border ring-inset"
            style:background-color={paint}
          >
            {#if (current ?? OWN) === choice}
              <Check class="size-4 text-white mix-blend-difference" />
            {/if}
          </span>
        </ToggleGroup.Item>
      {/each}
    </ToggleGroup.Root>
    <HexField
      label={m.colour_custom()}
      value={current ?? own}
      onchange={(colour) => {
        onchange(colour);
      }}
    />
  </div>
</Item.Root>
