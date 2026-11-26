<script lang="ts">
  import { mode } from "mode-watcher";
  import { Toaster as Sonner, type ToasterProps as SonnerProps } from "svelte-sonner";
  import Loader2Icon from "@lucide/svelte/icons/loader-2";
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import OctagonXIcon from "@lucide/svelte/icons/octagon-x";
  import InfoIcon from "@lucide/svelte/icons/info";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";

  let { ...restProps }: SonnerProps = $props();
</script>

<Sonner
  theme={mode.current ?? "dark"}
  class="toaster group"
  style="--normal-bg: var(--color-popover); --normal-text: var(--color-popover-foreground); --normal-border: var(--color-border); --border-radius: var(--radius-lg);"
  toastOptions={{
    classes: {
      // Local: svelte-sonner's own CSS hard-codes 400ms ease (enter, leave, restack, children) and 200ms ease-out (swipe-out); it exposes no variables, so the toast's classes set the motion item's duration and easing, `!` to beat its attribute selectors (#38).
      // Local: `--border-radius` above is svelte-sonner's own corner (8 px); the app's radius token instead (ADR 21, #760).
      // Local: the bottom bar's surface on every type, `richColors` included: ambient glass (over `glass`, which lifts the muted and destructive inks), an inset ring for svelte-sonner's border and elevation step 3 for its shadow, `!` to beat its `[data-styled]` rules. Status shows in the icon, not in a fill; its ink is lifted toward the foreground as `glass` lifts the destructive one, to hold 4.5:1 over the backdrop's lights (ADR 21, #760).
      toast:
        "cn-toast glass! glass-ambient! border-0! text-popover-foreground! ring-1 ring-inset ring-border elevation-3! focus-visible:ring-2 focus-visible:ring-ring data-[type=success]:**:data-icon:text-[color-mix(in_oklab,var(--foreground)_var(--glass-muted-mix),var(--success))] data-[type=warning]:**:data-icon:text-[color-mix(in_oklab,var(--foreground)_var(--glass-muted-mix),var(--warning))] data-[type=error]:**:data-icon:text-destructive duration-(--motion-base)! ease-(--motion-ease)! *:duration-(--motion-base)! *:ease-(--motion-ease)! data-[swipe-out=true]:[animation-duration:var(--motion-base)]! data-[swipe-out=true]:[animation-timing-function:var(--motion-ease)]!",
      // Local: svelte-sonner's description is a fixed grey per its own theme, not the app's; the muted ink (#760).
      description: "text-muted-foreground!",
      // Local: the button's radius instead of svelte-sonner's 4 px (#760).
      actionButton: "rounded-md!",
      // Local: svelte-sonner's cancel button is a translucent white (30%) in dark, which on glass drops its text below 4.5:1; an opaque muted chip, `!` to beat its selectors (#39).
      cancelButton: "rounded-md! bg-muted!",
    },
  }}
  {...restProps}
>
  {#snippet loadingIcon()}
    <!-- Local: the spin stops under reduced motion, as the kit's spinner (ADR 21, #836). -->
    <Loader2Icon class="size-4 animate-spin motion-reduce:animate-none" />
  {/snippet}
  {#snippet successIcon()}
    <CircleCheckIcon class="size-4" />
  {/snippet}
  {#snippet errorIcon()}
    <OctagonXIcon class="size-4" />
  {/snippet}
  {#snippet infoIcon()}
    <InfoIcon class="size-4" />
  {/snippet}
  {#snippet warningIcon()}
    <TriangleAlertIcon class="size-4" />
  {/snippet}
</Sonner>
