<!-- Who signs in (ADR 9): the admin by password alone, or a viewer by name and password. -->
<script lang="ts">
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";

  let { account = $bindable() }: { account: "admin" | "viewer" } = $props();

  function pick(next: string): void {
    if ((next !== "admin" && next !== "viewer") || next === account) return;

    haptics.selection();
    account = next;
  }
</script>

<ToggleGroup.Root
  type="single"
  spacing={1}
  bind:value={() => account, pick}
  class="grid w-full grid-cols-2 rounded-md p-0.5 ring-1 ring-border/60"
  aria-label={m.signin_account()}
>
  <ToggleGroup.Item value="admin">{m.signin_admin()}</ToggleGroup.Item>
  <ToggleGroup.Item value="viewer">{m.signin_viewer()}</ToggleGroup.Item>
</ToggleGroup.Root>
