<script lang="ts">
  import { AlertDialog as AlertDialogPrimitive } from "bits-ui";
  import { cn, type WithoutChild, type WithoutChildrenOrChild } from "@sunreye/ui/utils";
  import AlertDialogOverlay from "./alert-dialog-overlay.svelte";
  import AlertDialogPortal from "./alert-dialog-portal.svelte";
  import type { ComponentProps } from "svelte";

  let {
    ref = $bindable(null),
    class: className,
    size = "default",
    portalProps,
    ...restProps
  }: WithoutChild<AlertDialogPrimitive.ContentProps> & {
    size?: "default" | "sm";
    portalProps?: WithoutChildrenOrChild<ComponentProps<typeof AlertDialogPortal>>;
  } = $props();
</script>

<AlertDialogPortal {...portalProps}>
  <AlertDialogOverlay />
  <AlertDialogPrimitive.Content
    bind:ref
    data-slot="alert-dialog-content"
    data-size={size}
    class={cn(
      // Local: glass-modal, the spring-in and elevation step 4, timed by the motion tokens, as the dialog (ADR 21, #750).
      "data-open:animate-spring-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 glass-modal text-popover-foreground ring-foreground/10 gap-6 rounded-xl p-6 elevation-4 ring-1 duration-(--motion-base) ease-(--motion-ease) data-[size=default]:max-w-xs data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-lg group/alert-dialog-content fixed top-1/2 left-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 outline-none",
      className,
    )}
    {...restProps}
  />
</AlertDialogPortal>
