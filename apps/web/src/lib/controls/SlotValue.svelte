<!-- One value of a time-of-use slot: its field above, its value below; it opens the value editor. -->
<script lang="ts">
  import { Pressable } from "../components/ui/pressable/index.js";
  import type { Control } from "./groups.ts";

  let {
    control,
    caption,
    value,
    active,
    onedit,
  }: {
    control: Control;
    /** The field: start, power, SOC target, grid charge. */
    caption: string;
    /** Its current value as text. */
    value: string;
    /** The editor has it open. */
    active: boolean;
    onedit: (control: Control, at: HTMLElement) => void;
  } = $props();

  function open(e: MouseEvent & { currentTarget: HTMLElement }): void {
    if (control.writable) onedit(control, e.currentTarget);
  }
</script>

<Pressable
  onclick={open}
  aria-label={`${control.setting.name ?? control.setting.key} ${value}`}
  aria-disabled={!control.writable}
  aria-haspopup={control.writable ? "dialog" : undefined}
  class={[
    "flex min-w-0 flex-col items-start gap-0.5 rounded-md bg-muted/40 px-2 py-1.5 text-left ring-1 ring-border/60 duration-(--motion-fast) ring-inset",
    control.writable ? "hover:bg-muted/70 " : "cursor-default",
    active && "bg-muted",
  ]}
>
  <span class="w-full truncate text-xs text-muted-foreground">{caption}</span>
  <span class="text-[15px] font-medium whitespace-nowrap tabular-nums">{value}</span>
</Pressable>
