<!-- Settings › Display (ADR 21): this browser's theme, language, 3D quality (ADR 20), low-power and haptics switches. -->
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
  import { quality } from "../scene/quality.svelte.ts";
  import { parseQuality, QUALITIES, type Quality } from "../scene/quality.ts";

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

  const LEVELS: Readonly<Record<Quality, () => string>> = {
    auto: m.display_quality_auto,
    low: m.display_quality_low,
    medium: m.display_quality_medium,
    high: m.display_quality_high,
    ultra: m.display_quality_ultra,
  };

  /** What the 3D quality does here and now: nothing under low power, and on Auto its level. */
  const drawing = $derived.by(() => {
    if (motion.lowPower) return m.display_quality_low_power();

    return quality.choice === "auto"
      ? m.display_quality_now({ level: LEVELS[quality.look(motion.tier).level]() })
      : m.display_quality_hint();
  });

  function draw(next: string): void {
    // A segment pressed again sends nothing: the choice stays.
    if (next === "" || next === quality.choice) return;

    quality.choice = parseQuality(next);
    haptics.selection();
  }

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
  hint?: string,
)}
  <Item.Root class="rounded-none border-0">
    <Item.Content>
      <Item.Title class="text-[15px] font-normal">{label}</Item.Title>
      {#if hint}<Item.Description>{hint}</Item.Description>{/if}
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
    {@render segment(
      m.display_quality(),
      quality.choice,
      draw,
      QUALITIES.map((level) => [level, LEVELS[level]()] as const),
      drawing,
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
