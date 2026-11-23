<!--
  The kit's gallery (#750): every component of `components/ui`, as the app styles it. Development
  only: the gallery route loads it under `dev`, so no build carries it. Its texts are samples, not
  messages.
-->
<script lang="ts">
  import { mode, setMode } from "mode-watcher";
  import type { Component } from "svelte";
  import "../../app.css";
  import * as ToggleGroup from "@sunreye/ui/toggle-group";
  import * as Tooltip from "../components/ui/tooltip/index.js";

  /** Every section file, in name order: a new one joins the gallery by existing. */
  const sections = Object.entries(
    import.meta.glob<{ default: Component }>("./sections/*.svelte", { eager: true }),
  );
</script>

<Tooltip.Provider>
  <main data-gallery-root class="mx-auto flex w-full max-w-5xl flex-col px-4 py-6 sm:px-8">
    <header class="flex items-center justify-between gap-4 border-b pb-4">
      <h1 class="text-xl font-semibold">Gallery</h1>
      <ToggleGroup.Root
        type="single"
        variant="outline"
        size="sm"
        aria-label="Theme"
        value={mode.current ?? "dark"}
        onValueChange={(value) => {
          if (value === "light" || value === "dark") setMode(value);
        }}
      >
        <ToggleGroup.Item value="light">Light</ToggleGroup.Item>
        <ToggleGroup.Item value="dark">Dark</ToggleGroup.Item>
      </ToggleGroup.Root>
    </header>
    {#each sections as [path, { default: Section }] (path)}
      <Section />
    {/each}
  </main>
</Tooltip.Provider>
