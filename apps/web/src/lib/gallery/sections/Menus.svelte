<script lang="ts">
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import { buttonVariants } from "../../components/ui/button/index.js";
  import * as Command from "../../components/ui/command/index.js";
  import * as ContextMenu from "../../components/ui/context-menu/index.js";
  import * as DropdownMenu from "../../components/ui/dropdown-menu/index.js";
  import * as Menubar from "../../components/ui/menubar/index.js";
  import Demo from "../Demo.svelte";

  let grid = $state(true);
  let view = $state("3d");
</script>

<Demo name="dropdown-menu">
  <DropdownMenu.Root>
    <DropdownMenu.Trigger class={buttonVariants({ variant: "outline" })}>
      Series<ChevronDownIcon />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content>
      <DropdownMenu.Group>
        <DropdownMenu.Label>MPPT 1</DropdownMenu.Label>
        <DropdownMenu.Item>String east</DropdownMenu.Item>
        <DropdownMenu.Item>String west</DropdownMenu.Item>
      </DropdownMenu.Group>
      <DropdownMenu.Separator />
      <DropdownMenu.Group>
        <DropdownMenu.CheckboxItem bind:checked={grid}>Grid</DropdownMenu.CheckboxItem>
        <DropdownMenu.Item variant="destructive">Remove</DropdownMenu.Item>
      </DropdownMenu.Group>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</Demo>

<Demo name="context-menu">
  <ContextMenu.Root>
    <ContextMenu.Trigger
      class="grid h-20 w-64 place-items-center rounded-md border border-dashed text-sm text-muted-foreground"
    >
      Right-click here
    </ContextMenu.Trigger>
    <ContextMenu.Content>
      <ContextMenu.Group>
        <ContextMenu.Item>Rename</ContextMenu.Item>
        <ContextMenu.Item>Duplicate<ContextMenu.Shortcut>⌘D</ContextMenu.Shortcut></ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item variant="destructive">Remove</ContextMenu.Item>
      </ContextMenu.Group>
    </ContextMenu.Content>
  </ContextMenu.Root>
</Demo>

<Demo name="menubar">
  <Menubar.Root>
    <Menubar.Menu>
      <Menubar.Trigger>Scene</Menubar.Trigger>
      <Menubar.Content>
        <Menubar.Group>
          <Menubar.Item>Undo<Menubar.Shortcut>⌘Z</Menubar.Shortcut></Menubar.Item>
          <Menubar.Item>Redo<Menubar.Shortcut>⇧⌘Z</Menubar.Shortcut></Menubar.Item>
        </Menubar.Group>
      </Menubar.Content>
    </Menubar.Menu>
    <Menubar.Menu>
      <Menubar.Trigger>View</Menubar.Trigger>
      <Menubar.Content>
        <Menubar.RadioGroup bind:value={view}>
          <Menubar.RadioItem value="3d">3D</Menubar.RadioItem>
          <Menubar.RadioItem value="2d">2D</Menubar.RadioItem>
        </Menubar.RadioGroup>
      </Menubar.Content>
    </Menubar.Menu>
  </Menubar.Root>
</Demo>

<Demo name="command">
  <Command.Root class="w-72 border">
    <Command.Input placeholder="Search a profile" />
    <Command.List>
      <Command.Empty>No profile found.</Command.Empty>
      <Command.Group heading="Inverters">
        <Command.Item>SG05LP3</Command.Item>
        <Command.Item>SG04LP3</Command.Item>
      </Command.Group>
      <Command.Separator />
      <Command.Group heading="Meters">
        <Command.Item>SDM630</Command.Item>
      </Command.Group>
    </Command.List>
  </Command.Root>
</Demo>
