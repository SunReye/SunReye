<script lang="ts">
  import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
  import { cn } from "@sunreye/ui/utils";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: AlertDialogPrimitive.OverlayProps = $props();
</script>

<AlertDialogPrimitive.Overlay
  bind:ref
  data-slot="alert-dialog-overlay"
  // Local: the dialog's scrim and motion tokens instead of upstream's bg-black/10, backdrop-blur-xs and duration-100 (ADR 21, #750).
  class={cn(
    "data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 glass-scrim duration-(--motion-base) ease-(--motion-ease) fixed inset-0 z-50",
    className,
  )}
  {...restProps}
/>
