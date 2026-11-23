<script lang="ts">
  import { AspectRatio } from "../../components/ui/aspect-ratio/index.js";
  import * as Avatar from "../../components/ui/avatar/index.js";
  import * as Carousel from "../../components/ui/carousel/index.js";
  import * as Item from "@sunreye/ui/item";
  import * as Resizable from "../../components/ui/resizable/index.js";
  import { ScrollArea } from "../../components/ui/scroll-area/index.js";
  import { Badge } from "../../components/ui/badge/index.js";
  import Demo from "../Demo.svelte";

  type Reading = { name: string; volts: number; amps: number };
</script>

<Demo name="avatar">
  <Avatar.Root><Avatar.Fallback>ED</Avatar.Fallback></Avatar.Root>
  <Avatar.Root size="lg"><Avatar.Fallback>SR</Avatar.Fallback></Avatar.Root>
</Demo>

<Demo name="aspect-ratio">
  <div class="w-64">
    <AspectRatio ratio={16 / 9} class="grid place-items-center bg-muted text-sm">16 : 9</AspectRatio
    >
  </div>
</Demo>

<Demo name="carousel">
  <Carousel.Root class="mx-12 w-56">
    <Carousel.Content>
      {#each ["Solar", "Battery", "Grid"] as slide (slide)}
        <Carousel.Item>
          <div class="grid h-24 place-items-center border text-sm">{slide}</div>
        </Carousel.Item>
      {/each}
    </Carousel.Content>
    <Carousel.Previous />
    <Carousel.Next />
  </Carousel.Root>
</Demo>

<Demo name="scroll-area">
  <ScrollArea class="h-28 w-56 border">
    <ul class="flex flex-col gap-2 p-3 text-sm">
      {#each { length: 12 }, index (index)}
        <li>Reading {index + 1}</li>
      {/each}
    </ul>
  </ScrollArea>
</Demo>

<Demo name="resizable">
  <Resizable.PaneGroup direction="horizontal" class="h-24 w-80 border">
    <Resizable.Pane defaultSize={40} class="grid place-items-center text-sm">Groups</Resizable.Pane>
    <Resizable.Handle withHandle />
    <Resizable.Pane defaultSize={60} class="grid place-items-center text-sm"
      >Settings</Resizable.Pane
    >
  </Resizable.PaneGroup>
</Demo>

<!-- The scroll fade (#753): the border sits on a wrapper, the fade on the scroller inside it. -->
<Demo name="scroll-fade">
  <div class="w-56 border">
    <ul class="flex h-32 flex-col gap-2 overflow-y-auto p-3 text-sm scroll-fade-y no-scrollbar">
      {#each { length: 14 }, index (index)}
        <li>Log line {index + 1}</li>
      {/each}
    </ul>
  </div>
  <div class="w-72 border p-2">
    <div class="flex gap-2 overflow-x-auto scroll-fade-x no-scrollbar">
      {#each ["Day", "Week", "Month", "Year", "Custom", "Compare", "Forecast", "Tariff"] as chip (chip)}
        <Badge variant="outline" class="shrink-0">{chip}</Badge>
      {/each}
    </div>
  </div>
</Demo>
