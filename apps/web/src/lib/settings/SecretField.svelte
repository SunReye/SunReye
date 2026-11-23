<!--
  One credential of a connection (ADR 7): whether it is set, never its value. Typing sets a new
  one; empty keeps it; clearing removes it on save.
-->
<script lang="ts">
  import X from "@lucide/svelte/icons/x";
  import { Button } from "@sunreye/ui/button";
  import { Input } from "@sunreye/ui/input";
  import { m } from "../paraglide/messages.js";
  import { FIELD } from "../setup/fields.ts";

  let {
    label,
    set,
    hidden = false,
    value = $bindable(),
  }: {
    label: string;
    /** Whether the core holds it. */
    set: boolean;
    /** Typed as a password. */
    hidden?: boolean;
    /** The change on save: a new value, null to clear it, undefined to keep it. */
    value: string | null | undefined;
  } = $props();

  const state = $derived(
    value === null
      ? m.settings_secret_cleared({ name: label })
      : set
        ? m.settings_secret_set({ name: label })
        : m.settings_secret_unset({ name: label }),
  );
</script>

<div class={FIELD}>
  <div class="flex items-center gap-2">
    <span class="text-muted-foreground">{state}</span>
    {#if set && value !== null}
      <Button
        variant="ghost"
        size="icon-sm"
        class="ml-auto"
        aria-label={m.settings_secret_clear({ name: label })}
        onclick={() => {
          value = null;
        }}
      >
        <X />
      </Button>
    {/if}
  </div>
  <Input
    type={hidden ? "password" : "text"}
    autocomplete="off"
    aria-label={label}
    placeholder={set ? m.settings_secret_keep() : ""}
    bind:value={() => value ?? "", (next) => (value = next === "" ? undefined : next)}
  />
</div>
