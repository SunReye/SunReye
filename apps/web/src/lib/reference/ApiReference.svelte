<!--
  The core's OpenAPI document as a reference to read (ADR 11): Scalar in the app's look and
  language, its request client and everything that would reach past the page off.
-->
<script lang="ts">
  import { createApiReference } from "@scalar/api-reference";
  import "@scalar/api-reference/style.css";
  import { mode } from "mode-watcher";
  import { untrack } from "svelte";
  import LoadingRows from "../components/loading-rows.svelte";
  import ProblemAlert from "../components/problem-alert.svelte";
  import type { Core } from "../api/core.ts";
  import type { ApiDocument } from "../api/reference.ts";
  import { getLocale } from "../paraglide/runtime.js";
  import "./theme.css";

  let { core }: { core: Pick<Core, "reference"> } = $props();

  const answer = $derived(core.reference());

  const dark = $derived(mode.current !== "light");

  /** Scalar's settings for `document`: a reference to read, nothing it sends or keeps. */
  function settings(document: ApiDocument, darkMode: boolean) {
    return {
      content: document,
      theme: "none",
      forceDarkModeState: darkMode ? "dark" : "light",
      hideDarkModeToggle: true,
      urlRouting: false,
      withDefaultFonts: false,
      telemetry: false,
      persistAuth: false,
      agent: { disabled: true },
      showDeveloperTools: "never",
      hideClientButton: true,
      hideTestRequestButton: true,
      documentDownloadType: "json",
      localization: { locale: getLocale() },
    } as const;
  }

  /** Mounts Scalar on the node; it follows the theme, and takes its mode class with it. */
  function scalar(document: ApiDocument) {
    return (node: HTMLElement) => {
      const before = new Set(globalThis.document.body.classList);

      const reference = createApiReference(
        node,
        settings(
          document,
          untrack(() => dark),
        ),
      );

      // Scalar reads its forced mode only when it mounts; its styles follow the body's class.
      $effect(() => {
        const { classList } = globalThis.document.body;

        classList.toggle("dark-mode", dark);
        classList.toggle("light-mode", !dark);
      });

      return () => {
        reference.destroy();

        for (const name of ["dark-mode", "light-mode"])
          if (!before.has(name)) globalThis.document.body.classList.remove(name);
      };
    };
  }
</script>

{#await answer}
  <LoadingRows rows={6} />
{:then got}
  {#if "problem" in got}
    <ProblemAlert problem={got.problem} />
  {:else}
    <div class="reference" {@attach scalar(got)}></div>
  {/if}
{/await}
