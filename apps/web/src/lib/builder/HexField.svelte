<!-- A colour as `#rrggbb` in a text field, beside the swatch it names (ADR 21: free-form values keep a text field). -->
<script lang="ts">
  import { Input } from "@sunreye/ui/input";

  let {
    value,
    label,
    onchange,
  }: {
    /** `#rrggbb`. */
    value: string;
    label: string;
    onchange: (colour: string) => void;
  } = $props();

  const HEX = /^#[0-9a-f]{6}$/u;

  // What is typed, until it is a colour; a change from outside replaces it.
  let typed = $derived(value);

  const valid = $derived(HEX.test(typed.trim().toLowerCase()));
</script>

<div class="flex items-center gap-2">
  <span
    class="size-7 shrink-0 rounded-sm ring-1 ring-border ring-inset"
    style:background-color={value}
    aria-hidden="true"
  ></span>
  <Input
    aria-label={label}
    aria-invalid={!valid}
    class="h-9 w-28 font-mono"
    maxlength={7}
    spellcheck={false}
    autocapitalize="off"
    autocomplete="off"
    value={typed}
    oninput={(event) => {
      typed = event.currentTarget.value;
    }}
    onchange={(event) => {
      const colour = event.currentTarget.value.trim().toLowerCase();

      typed = colour;

      if (HEX.test(colour)) onchange(colour);
    }}
  />
</div>
