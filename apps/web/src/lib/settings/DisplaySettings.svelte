<!-- Settings › Display (ADR 21): this browser's theme, language, low-power and haptics switches. -->
<script lang="ts">
  import { setMode, userPrefersMode } from "mode-watcher";
  import { MediaQuery } from "svelte/reactivity";
  import * as Item from "#lib/components/ui/item/index.js";
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import ToggleRow from "./ToggleRow.svelte";
  import { HAPTICS, haptics, hapticsOn } from "../haptics.ts";
  import { endonym, language } from "../i18n/language.svelte.ts";
  import { motion } from "../motion/tier.svelte.ts";
  import { m } from "../paraglide/messages.js";
  import { isLocale, locales } from "../paraglide/runtime.js";

  const touch = new MediaQuery("(pointer: coarse)");
  const reduce = new MediaQuery("(prefers-reduced-motion: reduce)");

  let stored = $state(localStorage.getItem(HAPTICS));

  const feel = $derived(
    hapticsOn({
      stored,
      touch: touch.current,
      lowPower: motion.lowPower,
      reducedMotion: reduce.current,
    }),
  );

  /** Why haptics are held off, if they are. */
  const held = $derived.by(() => {
    if (motion.lowPower) return m.display_haptics_low_power();

    return reduce.current ? m.display_haptics_reduced() : undefined;
  });

  function theme(next: string): void {
    if (next !== "dark" && next !== "light") return;

    setMode(next);
    haptics.selection();
  }

  function speak(next: string): void {
    if (!isLocale(next) || next === language.current) return;

    haptics.selection();
    void language.choose(next);
  }

  function feelOn(on: boolean): void {
    stored = on ? "on" : "off";
    localStorage.setItem(HAPTICS, stored);
    haptics.selection();
  }
</script>

{#snippet segment(
  label: string,
  value: string,
  set: (next: string) => void,
  options: readonly (readonly [string, string])[],
)}
  <Item.Root class="rounded-none border-0">
    <Item.Content>
      <Item.Title class="text-[15px] font-normal">{label}</Item.Title>
    </Item.Content>
    <Item.Actions>
      <ToggleGroup.Root
        type="single"
        size="sm"
        spacing={1}
        bind:value={() => value, set}
        class="rounded-md p-0.5 ring-1 ring-border/60"
        aria-label={label}
      >
        {#each options as [option, text] (option)}
          <ToggleGroup.Item value={option} class="px-3 text-xs">{text}</ToggleGroup.Item>
        {/each}
      </ToggleGroup.Root>
    </Item.Actions>
  </Item.Root>
{/snippet}

<div class="drill-card">
  <Item.Group class="gap-0 divide-y divide-border/60">
    {@render segment(
      m.display_theme(),
      userPrefersMode.current === "light" ? "light" : "dark",
      theme,
      [
        ["dark", m.display_dark()],
        ["light", m.display_light()],
      ],
    )}
    {@render segment(
      m.locale_label(),
      language.current,
      speak,
      locales.map((locale) => [locale, endonym(locale)] as const),
    )}
    <ToggleRow
      label={m.display_low_power()}
      hint={m.display_low_power_hint()}
      checked={motion.lowPower}
      onchange={(on) => {
        motion.lowPower = on;
      }}
    />
    <ToggleRow
      label={m.display_haptics()}
      hint={held ?? m.display_haptics_hint()}
      checked={feel}
      disabled={held !== undefined}
      onchange={feelOn}
    />
  </Item.Group>
</div>
