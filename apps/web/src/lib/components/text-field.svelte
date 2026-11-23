<!-- A labelled text input: the form field around the kit's Input, which takes every other attribute. -->
<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";
  import FormField from "./form-field.svelte";
  import { Input } from "@sunreye/ui/input";

  let {
    label,
    hint,
    error,
    value = $bindable(),
    class: className,
    ...rest
  }: Omit<HTMLInputAttributes, "type" | "files" | "class"> & {
    label: string;
    hint?: string | undefined;
    error?: string | undefined;
    type?: "text" | "password" | "number" | "email" | "url" | "search" | "tel";
    /** Laid on the field, not the input. */
    class?: string;
  } = $props();
</script>

<FormField {label} {hint} {error} {...className === undefined ? {} : { class: className }}>
  {#snippet children({ id, invalid })}
    <Input {id} aria-invalid={invalid ? true : undefined} bind:value {...rest} />
  {/snippet}
</FormField>
