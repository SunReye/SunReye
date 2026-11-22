<!--
  Every write with its outcome (ADR 7), newest first: a list of entries on a phone, a table once the
  page has room for its columns.
-->
<script lang="ts">
  import * as Empty from "#lib/components/ui/empty/index.js";
  import * as Item from "#lib/components/ui/item/index.js";
  import * as Table from "#lib/components/ui/table/index.js";
  import type { Attempt, Problem, WriteLog } from "../api/core";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import { OUTCOMES } from "./outcomes";
  import { settingLabel } from "./setting-label.ts";

  /** The core refuses the log without the admin's session; then nothing shows. */
  let {
    log,
    devices,
  }: {
    log: WriteLog | Problem;
    /** Device names by id; an unknown one is named by its id. */
    devices: ReadonlyMap<number, string>;
  } = $props();

  const number = new Intl.NumberFormat(getLocale());
  const time = new Intl.DateTimeFormat(getLocale(), { dateStyle: "short", timeStyle: "medium" });

  function value(of: number | null | undefined): string {
    return of === null || of === undefined ? "–" : number.format(of);
  }

  const device = (id: number) => devices.get(id) ?? m.settings_device({ id });

  /** What the device held after the write, where it is not what was asked. */
  function after(entry: Attempt): string | undefined {
    return entry.after === entry.requested ? undefined : `${m.log_after()} ${value(entry.after)}`;
  }

  function step(entry: Attempt): string | undefined {
    return entry.failedStep === null || entry.failedStep === undefined
      ? undefined
      : m.settings_failed_step({ step: entry.failedStep });
  }

  /** Newest first; the log only grows, so a row's position is its key. */
  const entries = $derived(
    "writes" in log
      ? log.writes.toReversed().map((entry, row) => ({ entry, key: log.writes.length - row }))
      : [],
  );
</script>

{#if "writes" in log}
  {#if entries.length === 0}
    <Empty.Root class="p-8">
      <Empty.Header>
        <Empty.Title class="text-[15px]">{m.log_empty()}</Empty.Title>
        <Empty.Description>{m.log_empty_hint()}</Empty.Description>
      </Empty.Header>
    </Empty.Root>
  {:else}
    <div class="@container">
      <ul aria-label={m.writes_log()} class="divide-y divide-border/60 @2xl:hidden">
        {#each entries as { entry, key } (key)}
          <li>
            <Item.Root class="rounded-none border-0">
              <Item.Content class="min-w-0">
                <Item.Title class="text-[15px] font-normal">
                  {settingLabel({ key: entry.setting })}
                </Item.Title>
                <Item.Description class="tabular-nums">
                  {[device(entry.device), time.format(new Date(entry.time)), entry.actor].join(
                    " · ",
                  )}
                </Item.Description>
                <Item.Description>
                  {[OUTCOMES[entry.outcome](), after(entry), step(entry)].filter(Boolean).join(" ")}
                </Item.Description>
              </Item.Content>
              <Item.Actions
                class="self-start text-[15px] font-medium whitespace-nowrap tabular-nums"
              >
                {value(entry.before)} → {value(entry.requested)}
              </Item.Actions>
            </Item.Root>
          </li>
        {/each}
      </ul>
      <div class="hidden @2xl:block">
        <Table.Root aria-label={m.writes_log()} class="tabular-nums">
          <Table.Header>
            <Table.Row>
              <Table.Head>{m.log_time()}</Table.Head>
              <Table.Head>{m.log_device()}</Table.Head>
              <Table.Head>{m.log_setting()}</Table.Head>
              <Table.Head>{m.log_before()}</Table.Head>
              <Table.Head>{m.log_requested()}</Table.Head>
              <Table.Head>{m.log_after()}</Table.Head>
              <Table.Head>{m.log_outcome()}</Table.Head>
              <Table.Head>{m.log_actor()}</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each entries as { entry, key } (key)}
              <Table.Row>
                <Table.Cell>{time.format(new Date(entry.time))}</Table.Cell>
                <Table.Cell>{device(entry.device)}</Table.Cell>
                <Table.Cell>{settingLabel({ key: entry.setting })}</Table.Cell>
                <Table.Cell>{value(entry.before)}</Table.Cell>
                <Table.Cell>{value(entry.requested)}</Table.Cell>
                <Table.Cell>{value(entry.after)}</Table.Cell>
                <Table.Cell class="whitespace-normal">
                  {[OUTCOMES[entry.outcome](), step(entry)].filter(Boolean).join(" ")}
                </Table.Cell>
                <Table.Cell>{entry.actor}</Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </div>
    </div>
  {/if}
{/if}
