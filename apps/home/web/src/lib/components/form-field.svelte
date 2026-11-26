<!--
  A form's field on the kit's Field: its label above the control, then a hint and an error. The
  control takes the field's `id`, which the label points at, and `invalid` while an error stands.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import * as Field from "./ui/field/index.js";

  let {
    label,
    hint,
    error,
    class: className,
    children,
  }: {
    label: string;
    hint?: string | undefined;
    error?: string | undefined;
    class?: string;
    children: Snippet<[{ id: string; invalid: boolean }]>;
  } = $props();

  const id = $props.id();
</script>

<Field.Field class={["gap-1.5", className]} data-invalid={error === undefined ? undefined : ""}>
  <Field.Label for={id}>{label}</Field.Label>
  {@render children({ id, invalid: error !== undefined })}
  {#if hint !== undefined}<Field.Description>{hint}</Field.Description>{/if}
  {#if error !== undefined}<Field.Error>{error}</Field.Error>{/if}
</Field.Field>
