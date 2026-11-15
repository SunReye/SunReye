<script lang="ts">
  import { Button, buttonVariants } from "../../components/ui/button/index.js";
  import * as Tooltip from "../../components/ui/tooltip/index.js";
  import Demo from "../Demo.svelte";
</script>

<Demo name="tooltip">
  <Tooltip.Root>
    <Tooltip.Trigger class={buttonVariants({ variant: "outline" })}>Hover me</Tooltip.Trigger>
    <Tooltip.Content>Pinned per browser</Tooltip.Content>
  </Tooltip.Root>
</Demo>
