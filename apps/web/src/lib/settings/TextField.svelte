<!-- A labelled one-line text entry on the ui input. -->
<script lang="ts">
  import { Input } from "#lib/components/ui/input/index.js";
  import { FIELD } from "../setup/fields.ts";

  let {
    label,
    value = $bindable(),
    placeholder,
  }: { label: string; value: string; placeholder?: string } = $props();
</script>

<label class={FIELD}>
  {label}
  <Input required autocomplete="off" {...placeholder === undefined ? {} : { placeholder }} bind:value />
</label>
