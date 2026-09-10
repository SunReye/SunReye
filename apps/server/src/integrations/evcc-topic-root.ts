/**
 * WHERE THE EVCC INGEST'S TOPIC ROOT COMES FROM — the `evcc-ingest` row, with
 * `app_settings.evcc` as the fallback.
 *
 * The first reader to move onto the `integrations` table. The root is the
 * grammar of every topic the ingest subscribes to (`<root>/loadpoints/#`) and it
 * is the one field of the ingest that is not the broker, so it is what
 * `evccIngestParamsSchema` holds — and until now it lived in a JSONB settings
 * document that `readSetting` safe-parses to the DEFAULT with no log. An
 * operator's `garage` silently becoming `evcc` is a subscription to a tree
 * nothing publishes on: no readings, no error, no way to tell it from EVCC being
 * down (the settings-schema-silent-reset note).
 *
 * THE SETTING IS NOT RETIRED HERE, deliberately. An install that has not written
 * an integration row yet — every install before this release — must keep
 * subscribing under the root its operator chose, so the absence of a row means
 * "ask the setting" rather than "use the default". Retiring the setting is a
 * later change, once the wizard writes the row on every path that used to write
 * the document.
 *
 * `subtractFromHome` stays on the setting and is NOT read here. It is a rule
 * about how the house-load figure is composed — is the charger metered inside
 * `load.power`? — so it is plant-level, and two ingests must not be able to
 * disagree about one plant's load model. Migration 0006 made that call and
 * `@SunReye/db/integrations` argues it a second time.
 */

import { readIntegrations } from "@SunReye/db/integrations-store";
import type { IntegrationRecord } from "@SunReye/db/integrations-store";
import { readPlant } from "@SunReye/db/plant-repo";

import { plantClient } from "../shared/plant-client";

/**
 * The topic root the plant's EVCC ingest is configured with, or `fallback`.
 *
 * A loop rather than a `.find`, so the discriminated union narrows and the root
 * is read off the arm that actually has one — an `ha-export` row has no topic
 * root and must not be able to answer for the ingest.
 *
 * THE FIRST ingest row when a broker carries two. The table made two EVCC
 * instances on one broker expressible; this build still runs one subscription,
 * and taking the lowest-id row is the honest half-step. A client per row is the
 * change that finishes it, and it belongs in the ingest rather than here.
 */
// fallow-ignore-next-line unused-export -- the pure half, asserted directly in `./evcc-topic-root.test.ts`; its only production caller is `readEvccTopicRoot` below, and test files are not traced as consumers.
export function evccTopicRootFrom(rows: readonly IntegrationRecord[], fallback: string): string {
  for (const row of rows) if (row.kind === "evcc-ingest") return row.params.topicRoot;
  return fallback;
}

/** {@link evccTopicRootFrom} against the live database; `fallback` on an install with no plant. */
export async function readEvccTopicRoot(fallback: string): Promise<string> {
  const client = plantClient();
  const plant = await readPlant(client);
  if (!plant) return fallback;
  return evccTopicRootFrom(await readIntegrations(client, plant.id), fallback);
}
