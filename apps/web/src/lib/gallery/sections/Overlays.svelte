<script lang="ts">
  import { toast } from "svelte-sonner";
  import * as AlertDialog from "../../components/ui/alert-dialog/index.js";
  import { Button, buttonVariants } from "../../components/ui/button/index.js";
  import * as Dialog from "../../components/ui/dialog/index.js";
  import * as Drawer from "../../components/ui/drawer/index.js";
  import * as HoverCard from "../../components/ui/hover-card/index.js";
  import * as Popover from "../../components/ui/popover/index.js";
  import * as Sheet from "../../components/ui/sheet/index.js";
  import { Toaster } from "../../components/ui/sonner/index.js";
  import Demo from "../Demo.svelte";
</script>

<Demo name="dialog">
  <Dialog.Root>
    <Dialog.Trigger class={buttonVariants({ variant: "outline" })}>Open dialog</Dialog.Trigger>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>Add a measuring point</Dialog.Title>
        <Dialog.Description>It joins the topology under the grid.</Dialog.Description>
      </Dialog.Header>
      <Dialog.Footer>
        <Dialog.Close class={buttonVariants({ variant: "ghost" })}>Cancel</Dialog.Close>
        <Button>Add</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</Demo>

<Demo name="alert-dialog">
  <AlertDialog.Root>
    <AlertDialog.Trigger class={buttonVariants({ variant: "outline" })}>
      Open alert dialog
    </AlertDialog.Trigger>
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>Remove this device?</AlertDialog.Title>
        <AlertDialog.Description>Its readings stay in the history.</AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
        <AlertDialog.Action>Remove</AlertDialog.Action>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>
</Demo>

<Demo name="sheet">
  <Sheet.Root>
    <Sheet.Trigger class={buttonVariants({ variant: "outline" })}>Open sheet</Sheet.Trigger>
    <Sheet.Content>
      <Sheet.Header>
        <Sheet.Title>Battery</Sheet.Title>
        <Sheet.Description>Readings and the last two minutes.</Sheet.Description>
      </Sheet.Header>
    </Sheet.Content>
  </Sheet.Root>
</Demo>

<Demo name="drawer">
  <Drawer.Root>
    <Drawer.Trigger class={buttonVariants({ variant: "outline" })}>Open drawer</Drawer.Trigger>
    <Drawer.Content>
      <Drawer.Header>
        <Drawer.Title>More</Drawer.Title>
        <Drawer.Description>Every other screen.</Drawer.Description>
      </Drawer.Header>
      <Drawer.Footer>
        <Drawer.Close class={buttonVariants({ variant: "outline" })}>Close</Drawer.Close>
      </Drawer.Footer>
    </Drawer.Content>
  </Drawer.Root>
</Demo>

<Demo name="popover">
  <Popover.Root>
    <Popover.Trigger class={buttonVariants({ variant: "outline" })}>Open popover</Popover.Trigger>
    <Popover.Content>
      <Popover.Header>
        <Popover.Title>Charge limit</Popover.Title>
        <Popover.Description>10 A to 120 A, in steps of 5 A.</Popover.Description>
      </Popover.Header>
    </Popover.Content>
  </Popover.Root>
</Demo>

<Demo name="hover-card">
  <HoverCard.Root>
    <HoverCard.Trigger class={buttonVariants({ variant: "link" })}>MPPT 1</HoverCard.Trigger>
    <HoverCard.Content>Two strings share this input.</HoverCard.Content>
  </HoverCard.Root>
</Demo>

<Toaster />
<Demo name="sonner">
  <Button variant="outline" onclick={() => toast("Write confirmed", { description: "80 A" })}>
    Show toast
  </Button>
</Demo>
