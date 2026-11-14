<script lang="ts">
  import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
  import BoldIcon from "@lucide/svelte/icons/bold";
  import ItalicIcon from "@lucide/svelte/icons/italic";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import * as ButtonGroup from "../../components/ui/button-group/index.js";
  import { Button } from "../../components/ui/button/index.js";
  import { Separator } from "../../components/ui/separator/index.js";
  import * as ToggleGroup from "../../components/ui/toggle-group/index.js";
  import { Toggle } from "../../components/ui/toggle/index.js";
  import Demo from "../Demo.svelte";
</script>

<Demo name="button">
  <Button><PlusIcon data-icon="inline-start" />Default</Button>
  <Button variant="outline">Outline</Button>
  <Button variant="secondary">Secondary</Button>
  <Button variant="ghost">Ghost</Button>
  <Button variant="destructive">Destructive</Button>
  <Button variant="link">Link</Button>
  <Button size="sm">Small</Button>
  <Button size="lg">Large<ArrowRightIcon data-icon="inline-end" /></Button>
  <Button size="icon" aria-label="Add"><PlusIcon /></Button>
  <Button disabled>Disabled</Button>
</Demo>

<Demo name="button-group">
  <ButtonGroup.Root>
    <Button variant="outline">Day</Button>
    <Button variant="outline">Week</Button>
    <ButtonGroup.Separator />
    <ButtonGroup.Text>2026</ButtonGroup.Text>
  </ButtonGroup.Root>
</Demo>

<Demo name="toggle">
  <Toggle aria-label="Bold"><BoldIcon /></Toggle>
  <Toggle variant="outline" pressed aria-label="Italic"><ItalicIcon /></Toggle>
  <Toggle variant="hairline">kWh</Toggle>
</Demo>

<Demo name="toggle-group">
  <ToggleGroup.Root type="single" value="day" variant="outline" aria-label="Range">
    <ToggleGroup.Item value="day">Day</ToggleGroup.Item>
    <ToggleGroup.Item value="week">Week</ToggleGroup.Item>
    <ToggleGroup.Item value="month">Month</ToggleGroup.Item>
  </ToggleGroup.Root>
  <ToggleGroup.Root type="multiple" value={["bold"]} aria-label="Style">
    <ToggleGroup.Item value="bold" aria-label="Bold"><BoldIcon /></ToggleGroup.Item>
    <ToggleGroup.Item value="italic" aria-label="Italic"><ItalicIcon /></ToggleGroup.Item>
  </ToggleGroup.Root>
</Demo>
