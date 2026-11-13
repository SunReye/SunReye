<!-- An inspector row choosing a finish's colour: its own, a common one, or any (ADR 20). -->
<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import * as Item from "#lib/components/ui/item/index.js";
  import { m } from "../paraglide/messages.js";
  import type { Swatch } from "./colours.ts";

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

  const current = $derived(value ?? null);
  const custom = $derived(current !== null && !swatches.some(([colour]) => colour === current));

  const choices = $derived<readonly (readonly [string | null, string, string])[]>([
    [null, own, m.colour_default()],
    ...swatches.map(([colour, name]) => [colour, colour, name()] as const),
  ]);
</script>

<Item.Root class="flex-col items-stretch gap-2 rounded-none border-0">
  <Item.Title class="text-[15px] font-normal">{label}</Item.Title>
  <div role="radiogroup" aria-label={label} class="flex flex-wrap gap-1">
    {#each choices as [colour, paint, name] (name)}
      <button
        type="button"
        role="radio"
        aria-checked={current === colour}
        aria-label={name}
        title={name}
        class="grid size-11 place-items-center rounded-sm hover:bg-muted/60"
        onclick={() => {
          onchange(colour);
        }}
      >
        <span
          class={[
            "grid size-7 place-items-center rounded-sm ring-1 ring-border ring-inset",
            current === colour && "ring-2 ring-primary",
          ]}
          style:background={paint}
        >
          {#if current === colour}<Check class="size-4 text-white mix-blend-difference" />{/if}
        </span>
      </button>
    {/each}
    <!-- The system picker opens from the label; the swatch shows the colour it chose. -->
    <label
      class="grid size-11 cursor-pointer place-items-center rounded-sm hover:bg-muted/60"
      title={m.colour_custom()}
    >
      <span
        class={[
          "grid size-7 place-items-center rounded-sm ring-1 ring-border ring-inset",
          custom
            ? "ring-2 ring-primary"
            : "bg-[conic-gradient(#e0533d,#e8b23a,#5bb34a,#3a8de0,#9a4fd0,#e0533d)]",
        ]}
        style:background={custom ? current : undefined}
      >
        {#if custom}<Check class="size-4 text-white mix-blend-difference" />{/if}
      </span>
      <input
        type="color"
        class="sr-only"
        aria-label={m.colour_custom()}
        value={current ?? own}
        onchange={(event) => {
          onchange(event.currentTarget.value);
        }}
      />
    </label>
  </div>
</Item.Root>
