<script lang="ts">
  import { toast } from "svelte-sonner";
  import * as AlertDialog from "../../components/ui/alert-dialog/index.js";
  import { Button, buttonVariants } from "@sunreye/ui/button";
  import * as Dialog from "@sunreye/ui/dialog";
  import * as Drawer from "@sunreye/ui/drawer";
  import * as HoverCard from "../../components/ui/hover-card/index.js";
  import * as Popover from "@sunreye/ui/popover";
  import * as Sheet from "../../components/ui/sheet/index.js";
  import { Toaster } from "../../components/ui/sonner/index.js";
  import Demo from "../Demo.svelte";

  const sample = { description: "80 A" };
  const nothing = (): void => {};

  /** Every toast type, by the name on its button. */
  const toasts: [name: string, raise: () => void][] = [
    ["Toast", () => toast("Write confirmed", sample)],
    ["Success", () => toast.success("Saved", sample)],
    ["Error", () => toast.error("Write refused", sample)],
    ["Info", () => toast.info("Tariff changes at 22:00", sample)],
    ["Warning", () => toast.warning("Battery at reserve", sample)],
    ["Loading", () => toast.loading("Writing", sample)],
    ["Action", () => toast("Removed", { action: { label: "Undo", onClick: nothing } })],
    ["Cancel", () => toast("Update ready", { cancel: { label: "Later", onClick: nothing } })],
  ];
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
      <ul
        class="flex max-h-[50dvh] flex-col gap-3 overflow-y-auto px-4 text-sm scroll-fade-y no-scrollbar"
      >
        {#each { length: 30 }, index (index)}
          <li>Screen {index + 1}</li>
        {/each}
      </ul>
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
  {#each toasts as [name, raise] (name)}
    <Button variant="outline" onclick={raise}>{name}</Button>
  {/each}
</Demo>
