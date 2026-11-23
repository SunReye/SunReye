<!-- A History figure: it glides to a new range's value in the figures' one time (ADR 21). -->
<script lang="ts">
  import type { ComponentProps } from "svelte";
  import AnimatedNumber from "../components/animated-number.svelte";
  import { FIGURE_GLIDE_MS } from "@sunreye/builder/values";

  let props: Omit<ComponentProps<typeof AnimatedNumber>, "duration"> = $props();
</script>

<AnimatedNumber {...props} duration={FIGURE_GLIDE_MS} />
