<script lang="ts">
  import InboxIcon from "@lucide/svelte/icons/inbox";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import ZapIcon from "@lucide/svelte/icons/zap";
  import * as Alert from "../../components/ui/alert/index.js";
  import { Button } from "../../components/ui/button/index.js";
  import * as Card from "../../components/ui/card/index.js";
  import * as Empty from "../../components/ui/empty/index.js";
  import * as Item from "../../components/ui/item/index.js";
  import Demo from "../Demo.svelte";
</script>

<Demo name="card">
  <Card.Root class="w-72">
    <Card.Header>
      <Card.Title>Today</Card.Title>
      <Card.Description>Production and consumption</Card.Description>
    </Card.Header>
    <Card.Content class="text-2xl font-semibold tabular-nums">18.4 kWh</Card.Content>
    <Card.Footer><Button variant="outline" size="sm">Open in history</Button></Card.Footer>
  </Card.Root>
  <Card.Root class="glass-ambient w-72">
    <Card.Header>
      <Card.Title>Ambient glass</Card.Title>
      <Card.Description>A card on the backdrop</Card.Description>
    </Card.Header>
    <Card.Content class="text-2xl font-semibold tabular-nums">3.2 kW</Card.Content>
  </Card.Root>
</Demo>

<Demo name="alert">
  <Alert.Root class="w-80">
    <ZapIcon />
    <Alert.Title>Writes are off</Alert.Title>
    <Alert.Description>Every control is read-only.</Alert.Description>
  </Alert.Root>
  <Alert.Root variant="destructive" class="w-80">
    <TriangleAlertIcon />
    <Alert.Title>Refused</Alert.Title>
    <Alert.Description>The inverter kept 100 A.</Alert.Description>
  </Alert.Root>
</Demo>

<Demo name="item">
  <Item.Group class="w-80">
    <Item.Root variant="outline">
      <Item.Media variant="icon"><ZapIcon /></Item.Media>
      <Item.Content>
        <Item.Title>Inverter</Item.Title>
        <Item.Description>SG05LP3 · Modbus TCP</Item.Description>
      </Item.Content>
      <Item.Actions><Button variant="outline" size="sm">Open</Button></Item.Actions>
    </Item.Root>
  </Item.Group>
</Demo>

<Demo name="empty">
  <Empty.Root class="w-80 border">
    <Empty.Header>
      <Empty.Media variant="icon"><InboxIcon /></Empty.Media>
      <Empty.Title>No writes yet</Empty.Title>
      <Empty.Description>A changed setting appears here.</Empty.Description>
    </Empty.Header>
  </Empty.Root>
  <Empty.Root size="dense" class="w-64 border">
    <Empty.Description>No devices.</Empty.Description>
  </Empty.Root>
</Demo>
