<script lang="ts">
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import * as Accordion from "../../components/ui/accordion/index.js";
  import { buttonVariants } from "../../components/ui/button/index.js";
  import * as Collapsible from "../../components/ui/collapsible/index.js";
  import Demo from "../Demo.svelte";
</script>

<Demo name="accordion">
  <Accordion.Root type="single" value="strings" class="w-80">
    <Accordion.Item value="strings">
      <Accordion.Trigger>Strings</Accordion.Trigger>
      <Accordion.Content>Two strings on MPPT 1.</Accordion.Content>
    </Accordion.Item>
    <Accordion.Item value="battery">
      <Accordion.Trigger>Battery</Accordion.Trigger>
      <Accordion.Content>One battery at 51.2 V.</Accordion.Content>
    </Accordion.Item>
  </Accordion.Root>
</Demo>

<Demo name="collapsible">
  <Collapsible.Root class="flex w-80 flex-col gap-2">
    <Collapsible.Trigger class={buttonVariants({ variant: "outline" })}>
      Advanced<ChevronDownIcon />
    </Collapsible.Trigger>
    <Collapsible.Content class="text-sm text-muted-foreground">
      Settings without a role.
    </Collapsible.Content>
  </Collapsible.Root>
</Demo>
