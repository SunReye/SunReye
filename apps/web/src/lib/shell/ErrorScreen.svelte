<!--
  What a route shows when it cannot: an unknown address, or a failure while rendering. One glass
  surface over the backdrop, inside the shell, so the navigation stays (ADR 21): what happened,
  the one way out first, the technical line last and quiet.
-->
<script lang="ts">
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import * as Card from "@sunreye/ui/card";
  import { Button } from "@sunreye/ui/button";
  import * as Empty from "../components/ui/empty/index.js";
  import { m } from "../paraglide/messages.js";
  import ErrorMark from "./ErrorMark.svelte";

  let {
    status,
    message,
    reload,
  }: {
    /** The HTTP status SvelteKit gives the error. */
    status: number;
    message: string;
    reload: () => void;
  } = $props();

  // Reloading an address that does not exist finds it missing again.
  const missing = $derived(status === 404);
  const detail = $derived([m.error_code({ status }), message].filter(Boolean).join(" · "));
</script>

<main class="mx-auto grid min-h-[70dvh] w-full max-w-2xl place-items-center px-4 py-6">
  <Card.Root class="w-full max-w-md gap-0 py-0">
    <Empty.Root class="border-0 px-6 py-10" role="alert">
      <Empty.Header>
        <Empty.Media><ErrorMark /></Empty.Media>
        <!-- The screen's one h1, in the kit's empty title. -->
        <h1 class="text-lg font-medium tracking-tight">
          {missing ? m.error_missing_title() : m.error_title()}
        </h1>
        <Empty.Description>{missing ? m.error_missing_hint() : m.error_hint()}</Empty.Description>
      </Empty.Header>
      <Empty.Content>
        <div class="flex flex-wrap justify-center gap-2">
          {#if !missing}
            <Button onclick={reload}><RotateCw data-icon="inline-start" />{m.error_reload()}</Button
            >
          {/if}
          <Button variant={missing ? "default" : "outline"} href="#/">{m.error_home()}</Button>
        </div>
        <p class="line-clamp-3 text-xs break-words text-muted-foreground tabular-nums">{detail}</p>
      </Empty.Content>
    </Empty.Root>
  </Card.Root>
</main>
